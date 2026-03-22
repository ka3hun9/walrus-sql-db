import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WalrusSqlClient } from "../src/client.js";

type StatementCase = {
  kind: "statement";
  expect: "ok" | "error";
  sql: string;
};

type QueryCase = {
  kind: "query";
  mode: "rowsort" | "nosort";
  sql: string;
  expected: string[];
};

type SqlLogicCase = StatementCase | QueryCase;

function normalizeLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function isHeader(line: string): boolean {
  return /^statement\s+(ok|error)$/i.test(line) || /^query(?:\s+(rowsort|nosort))?$/i.test(line);
}

function parseCases(raw: string): SqlLogicCase[] {
  const lines = normalizeLines(raw);
  const cases: SqlLogicCase[] = [];
  let i = 0;

  const nextNonEmpty = (): void => {
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) {
        i += 1;
        continue;
      }
      break;
    }
  };

  while (i < lines.length) {
    nextNonEmpty();
    if (i >= lines.length) break;

    const header = lines[i].trim();
    if (!isHeader(header)) {
      throw new Error(`Invalid sqllogic header at line ${i + 1}: ${header}`);
    }
    i += 1;

    const sqlLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "----") {
        i += 1;
        break;
      }
      sqlLines.push(line);
      i += 1;
    }

    const sql = sqlLines.join("\n").trim();
    if (!sql) throw new Error(`Empty SQL block for case header: ${header}`);

    const stmtMatch = header.match(/^statement\s+(ok|error)$/i);
    if (stmtMatch) {
      cases.push({
        kind: "statement",
        expect: stmtMatch[1].toLowerCase() as "ok" | "error",
        sql,
      });
      continue;
    }

    const qMatch = header.match(/^query(?:\s+(rowsort|nosort))?$/i);
    const mode = (qMatch?.[1]?.toLowerCase() ?? "rowsort") as "rowsort" | "nosort";
    const expected: string[] = [];

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "----") {
        i += 1;
        break;
      }
      if (line.trim() && !line.trim().startsWith("#")) expected.push(line.trim());
      i += 1;
    }

    cases.push({ kind: "query", mode, sql, expected });
  }

  return cases;
}

function formatValue(v: unknown): string {
  if (v === null) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function serializeRow(row: Record<string, unknown>): string {
  return Object.values(row).map(formatValue).join("|");
}

function sorted(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

export async function runSqlLogicFile(path: string): Promise<{ total: number; passed: number }> {
  const full = resolve(path);
  const raw = readFileSync(full, "utf8");
  const cases = parseCases(raw);

  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
  });

  let passed = 0;
  for (let idx = 0; idx < cases.length; idx += 1) {
    const c = cases[idx]!;
    const caseNo = idx + 1;

    if (c.kind === "statement") {
      try {
        await db.execute(c.sql);
        if (c.expect === "error") {
          throw new Error(`case#${caseNo} expected error but got success`);
        }
        passed += 1;
      } catch (err) {
        if (c.expect === "error") {
          passed += 1;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`case#${caseNo} statement failed: ${msg}`);
        }
      }
      continue;
    }

    const out = await db.query(c.sql);
    const actual = out.rows.map((r) => serializeRow(r as Record<string, unknown>));
    const lhs = c.mode === "rowsort" ? sorted(actual) : actual;
    const rhs = c.mode === "rowsort" ? sorted(c.expected) : c.expected;

    if (lhs.length !== rhs.length || lhs.some((line, i2) => line !== rhs[i2])) {
      throw new Error(`case#${caseNo} query mismatch\nexpected=${JSON.stringify(rhs)}\nactual=${JSON.stringify(lhs)}`);
    }
    passed += 1;
  }

  return { total: cases.length, passed };
}

async function main(): Promise<void> {
  const file = process.argv[2] ?? "test/sqllogic/p1-basic.slt";
  const out = await runSqlLogicFile(file);
  // eslint-disable-next-line no-console
  console.log(`sqllogic ok: ${out.passed}/${out.total} (${file})`);
}

const isDirectExecution = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectExecution) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
