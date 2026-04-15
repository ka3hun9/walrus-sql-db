/**
 * sqllogictest core runner
 *
 * Executes parsed SLT documents against a WalrusSqlClient in simulator mode.
 * Each .slt file is an independent test session (fresh client per file).
 */

import type {
  SltDocument,
  SltElement,
  SltStatement,
  SltQuery,
  SltResult,
  SltResultRow,
  SltFileRunResult,
  SltQueryResult,
  SltStatementResult,
} from "./types.js";
import { parseSlt } from "./parser.js";
import { diffResults, diffStatement } from "./diff.js";
import { checkFailure, makeTestId } from "./known-failures.js";

/** Check if a skipif/onlyif condition matches the current environment */
function evaluateGuard(condition: string, clientInfo: ClientInfo): boolean {
  const c = condition.trim().toLowerCase();

  // Common conditions
  if (c === "sqlite3") return clientInfo.engine === "sqlite";
  if (c === "mysql") return clientInfo.engine === "mysql";
  if (c === "pgsql" || c === "postgresql") return clientInfo.engine === "postgresql";
  if (c === "walrus") return clientInfo.engine === "walrus";
  if (c === "crdb" || c === "cockroachdb") return clientInfo.engine === "cockroachdb";

  // Version checks
  const verMatch = c.match(/sqlite\s*([<>=]+)\s*([\d.]+)/);
  if (verMatch) {
    const [, op, version] = verMatch;
    const actual = clientInfo.engineVersion;
    const cmp = compareVersions(actual, version);
    switch (op) {
      case "<":  return cmp < 0;
      case "<=": return cmp <= 0;
      case ">":  return cmp > 0;
      case ">=": return cmp >= 0;
      case "=":  return cmp === 0;
    }
  }

  // mode checks
  if (c.startsWith("mode:")) {
    return clientInfo.mode === c.slice(5);
  }

  // Unknown condition — conservative: don't skip (run the test)
  console.warn(`Unknown skipif/onlyif condition: "${condition}", running test`);
  return false;
}

function compareVersions(a: string, b: string): number {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

interface ClientInfo {
  engine: string;
  engineVersion: string;
  mode: string;
}

/** SQL client interface needed by the runner */
export interface SqlClient {
  execute(sql: string): Promise<ExecuteResult>;
}

export interface ExecuteResult {
  rows?: Record<string, string | number | null>[];
  statementType: string;
  affectedRows?: number;
  error?: string;
}

/** Convert ExecuteResult rows to SltResultRow format */
function toResultRows(result: ExecuteResult, query: SltQuery): SltResultRow[] {
  if (!result.rows || result.rows.length === 0) return [];

  const colCount = query.typeSignature.columns.length;

  return result.rows.map((row) => {
    // Extract values in column order (SltQuery doesn't tell us which columns to select,
    // but the typeSignature tells us how many columns to expect)
    // We need to map row object to ordered columns
    const keys = Object.keys(row);
    const ordered: string[] = [];

    if (colCount === 1 && keys.length === 1) {
      // Single column case
      ordered.push(String(row[keys[0]!] ?? ""));
    } else {
      // Try to preserve insertion order (works in most JS engines for non-numeric keys)
      for (const k of keys) {
        ordered.push(String(row[k] ?? ""));
      }
    }

    return ordered;
  });
}

/** Result of running a single query against the client */
async function runQuery(
  query: SltQuery,
  client: SqlClient,
  clientInfo: ClientInfo,
): Promise<SltResult> {
  const id = makeTestId(query.line.toString(), query.line);

  // Check known failures first
  const known = checkFailure("file", query.line);
  if (known) {
    return { status: "skipped", reason: `known failure: ${known.description}` };
  }

  // Evaluate skipif guards
  for (const cond of query.skipIf) {
    if (evaluateGuard(cond, clientInfo)) {
      return { status: "skipped", reason: `skipif: ${cond}` };
    }
  }

  // Evaluate onlyif guards
  for (const cond of query.onlyIf) {
    if (!evaluateGuard(cond, clientInfo)) {
      return { status: "skipped", reason: `onlyif failed: ${cond}` };
    }
  }

  // Execute query
  try {
    const result = await client.execute(query.sql);

    if (result.error) {
      return { status: "failed", message: `Query error: ${result.error}` };
    }

    const actualRows = toResultRows(result, query);

    const diff = diffResults(actualRows, query.results, query, /* hashThreshold */ 1000);
    if (!diff.equal) {
      return {
        status: "failed",
        message: diff.message ?? "Result mismatch",
        expected: query.results.join("\n"),
        actual: actualRows.map((r) => r.join("\t")).join("\n"),
      };
    }

    return { status: "passed" };
  } catch (err) {
    return { status: "failed", message: `Exception: ${err}` };
  }
}

/** Result of running a single statement against the client */
async function runStatement(
  statement: SltStatement,
  client: SqlClient,
  clientInfo: ClientInfo,
): Promise<SltResult> {
  // Check known failures
  const known = checkFailure("file", statement.line);
  if (known) {
    return { status: "skipped", reason: `known failure: ${known.description}` };
  }

  // Evaluate skipif guards
  for (const cond of statement.skipIf) {
    if (evaluateGuard(cond, clientInfo)) {
      return { status: "skipped", reason: `skipif: ${cond}` };
    }
  }

  // Evaluate onlyif guards
  for (const cond of statement.onlyIf) {
    if (!evaluateGuard(cond, clientInfo)) {
      return { status: "skipped", reason: `onlyif failed: ${cond}` };
    }
  }

  try {
    const result = await client.execute(statement.sql);

    const actualOk = !result.error;
    const actualErrorCode = extractErrorCode(result.error);

    const diff = diffStatement(
      actualOk,
      statement.type === "ok",
      actualErrorCode,
      statement.errorCode,
    );

    if (!diff.equal) {
      return { status: "failed", message: diff.message };
    }

    return { status: "passed" };
  } catch (err) {
    if (statement.type === "error") {
      return { status: "passed" };
    }
    return { status: "failed", message: `Unexpected exception: ${err}` };
  }
}

/** Extract error code from an error message */
function extractErrorCode(error?: string): string | undefined {
  if (!error) return undefined;
  // Look for SQLITE_CONSTRAINT, etc.
  const m = error.match(/([A-Z_]+)/);
  return m ? m[1] : undefined;
}

/** Run a single SLT file against a client factory */
export async function runSltFile(
  filePath: string,
  source: string,
  clientFactory: () => SqlClient,
  clientInfo: ClientInfo = { engine: "walrus", engineVersion: "0.3.0", mode: "simulator" },
): Promise<SltFileRunResult> {
  const doc = parseSlt(source, filePath);

  // Check file-level guards
  for (const cond of doc.fileSkipIf) {
    if (evaluateGuard(cond, clientInfo)) {
      return {
        filePath,
        fileSkipped: true,
        skipReason: `file-level skipif: ${cond}`,
        halted: doc.halted,
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        testsSkipped: 0,
        failures: [],
      };
    }
  }

  for (const cond of doc.fileOnlyIf) {
    if (!evaluateGuard(cond, clientInfo)) {
      return {
        filePath,
        fileSkipped: true,
        skipReason: `file-level onlyif failed: ${cond}`,
        halted: doc.halted,
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        testsSkipped: 0,
        failures: [],
      };
    }
  }

  // Create a fresh client for this file session
  const client = clientFactory();

  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let testsSkipped = 0;
  const failures: SltResult[] = [];

    for (const el of doc.elements) {
    if (el.kind === "halt") {
      failures.push({ status: "halted" });
      break;
    }

    if (el.kind === "statement") {
      testsRun++;
      const r = await runStatement(el as SltStatement, client, clientInfo);
      if (r.status === "passed") testsPassed++;
      else if (r.status === "skipped") testsSkipped++;
      else testsFailed++;
      if (r.status === "failed" || r.status === "halted") failures.push(r);
    } else if (el.kind === "query") {
      testsRun++;
      const r = await runQuery(el as SltQuery, client, clientInfo);
      if (r.status === "passed") testsPassed++;
      else if (r.status === "skipped") testsSkipped++;
      else testsFailed++;
      if (r.status === "failed" || r.status === "halted") failures.push(r);
    }
  }

  return {
    filePath,
    fileSkipped: false,
    halted: doc.halted,
    testsRun,
    testsPassed,
    testsFailed,
    testsSkipped,
    failures,
  };
}

/** Run multiple SLT files */
export async function runSltFiles(
  files: Array<{ path: string; content: string }>,
  clientFactory: () => SqlClient,
  clientInfo?: ClientInfo,
): Promise<SltFileRunResult[]> {
  return Promise.all(files.map((f) => runSltFile(f.path, f.content, clientFactory, clientInfo)));
}

/** Summarize results across multiple files */
export interface SltRunSummary {
  totalFiles: number;
  filesSkipped: number;
  totalTests: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  haltedFiles: number;
  passRate: string;
}

export function summarizeResults(results: SltFileRunResult[]): SltRunSummary {
  let totalFiles = results.length;
  let filesSkipped = 0;
  let totalTests = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let testsSkipped = 0;
  let haltedFiles = 0;

  for (const r of results) {
    if (r.fileSkipped) filesSkipped++;
    totalTests += r.testsRun;
    testsPassed += r.testsPassed;
    testsFailed += r.testsFailed;
    testsSkipped += r.testsSkipped;
    if (r.halted) haltedFiles++;
  }

  const passRate = totalTests > 0 ? `${((testsPassed / totalTests) * 100).toFixed(1)}%` : "N/A";

  return {
    totalFiles,
    filesSkipped,
    totalTests,
    testsPassed,
    testsFailed,
    testsSkipped,
    haltedFiles,
    passRate,
  };
}
