import { createHash } from "node:crypto";

export type OnchainStatementType = "CREATE" | "INSERT" | "UPDATE" | "DELETE";

export interface MoveCallRequest {
  target: string;
  arguments: string[];
  tableName?: string;
  typeArguments?: string[];
  gasBudget?: number;
  statementType: OnchainStatementType;
}

export interface OnchainExecutionResult {
  digest: string;
  raw?: unknown;
  createdTableId?: string;
}

export type OnchainExecutor = (req: MoveCallRequest) => Promise<OnchainExecutionResult>;

const lastCommitHashByTable = new Map<string, string>();

// ─── Paged Storage Support ───────────────────────────────────────────────────

/** Page-based version tracking per table */
interface PageVersionChain {
  /** table → current head page hash */
  headPageHash: string;
  /** table → version hash of latest manifest snapshot */
  manifestVersion: string;
  /** table → array of page hashes in order */
  pageChain: string[];
}

const pagedVersionChain: PageVersionChain = {
  headPageHash: "GENESIS",
  manifestVersion: "GENESIS",
  pageChain: [],
};

export interface PagedMoveCallRequest extends MoveCallRequest {
  pageIndex?: number;
  objectId?: string;
  pageData?: string;
  manifest?: object;
}

export interface PageCommitPayload {
  v: 3;
  table: string;
  op: "PAGE_INSERT" | "PAGE_DELETE" | "PAGE_UPDATE";
  pageIndex: number;
  objectId: string;
  rows: Record<string, unknown>[];
  previousHeadHash: string;
  previousManifestVersion: string;
  previousPageHash: string | null;
  ts: number;
}

/**
 * Build a paged (content-addressable) MoveCall that splits large tables
 * into multiple objects, each identified by its content hash.
 *
 * Benefits:
 * - Avoids oversized single objects (>1MB typical Sui/Walrus limit)
 * - Enables content-addressed versioning (Git-like history)
 * - Each page can be cached independently
 * - Parallel reads of independent pages
 */
export function buildPagedMoveCall(params: {
  packageId: string;
  moduleName?: string;
  table: string;
  pageIndex: number;
  rows: Record<string, unknown>[];
  operation: "PAGE_INSERT" | "PAGE_DELETE" | "PAGE_UPDATE";
}): PagedMoveCallRequest {
  const moduleName = params.moduleName ?? "walrus_sql";
  const { table, pageIndex, rows, operation } = params;

  const pageData = JSON.stringify({ table, pageIndex, rows });
  const objectId = hashHex(pageData);

  // Get previous versions from chain
  const previousHeadHash = lastCommitHashByTable.get(table) ?? "GENESIS";

  const payloadBase: PageCommitPayload = {
    v: 3,
    table,
    op: operation,
    pageIndex,
    objectId,
    rows,
    previousHeadHash,
    previousManifestVersion: pagedVersionChain.manifestVersion,
    previousPageHash: pagedVersionChain.pageChain[pagedVersionChain.pageChain.length - 1] ?? null,
    ts: Date.now(),
  };

  const currentCommitHash = hashHex(JSON.stringify(payloadBase));
  const payload = JSON.stringify({ ...payloadBase, currentCommitHash });

  // Update paged version chain
  lastCommitHashByTable.set(table, currentCommitHash);
  pagedVersionChain.headPageHash = currentCommitHash;
  pagedVersionChain.manifestVersion = hashHex(
    JSON.stringify({
      table,
      manifestVersion: payloadBase.previousManifestVersion,
      newPageHash: objectId,
    }),
  );
  pagedVersionChain.pageChain.push(objectId);

  return {
    target: `${params.packageId}::${moduleName}::paged_${operation.toLowerCase()}`,
    arguments: [objectId, payload, hashHex(`index:${table}:page:${pageIndex}`)],
    tableName: table,
    pageIndex,
    objectId,
    pageData: payload,
    statementType: operationToStatementType(operation),
  };
}

/**
 * Get version history of a table — returns all past version hashes.
 * Useful for read-repair, conflict detection, and history queries.
 */
export function getTableVersionHistory(table: string): {
  headHash: string;
  manifestVersion: string;
  pageChain: string[];
} {
  const headHash = lastCommitHashByTable.get(table) ?? "GENESIS";
  return {
    headHash,
    manifestVersion: pagedVersionChain.manifestVersion,
    pageChain: [...pagedVersionChain.pageChain],
  };
}

/** Reset version tracking for a table (used in tests or fresh state) */
export function resetTableVersion(table: string): void {
  lastCommitHashByTable.delete(table);
  pagedVersionChain.pageChain = pagedVersionChain.pageChain.filter((p) => !p.startsWith(table));
  pagedVersionChain.manifestVersion = hashHex(
    JSON.stringify({ reset: table, at: Date.now() }),
  );
}

function operationToStatementType(op: "PAGE_INSERT" | "PAGE_DELETE" | "PAGE_UPDATE"): OnchainStatementType {
  if (op === "PAGE_INSERT") return "INSERT";
  if (op === "PAGE_DELETE") return "DELETE";
  return "UPDATE";
}

export function buildMoveCall(params: {
  packageId: string;
  moduleName?: string;
  sql: string;
}): MoveCallRequest {
  const moduleName = params.moduleName ?? "walrus_sql";
  const sql = params.sql.trim().replace(/\s+/g, " ");
  const upper = sql.toUpperCase();

  if (upper.startsWith("CREATE TABLE")) {
    const m = sql.match(/CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)/i);
    if (!m) throw new Error(`Unsupported CREATE TABLE syntax: ${sql}`);
    const table = m[1];
    const schema = m[2];
    return {
      target: `${params.packageId}::${moduleName}::create_table`,
      arguments: [table, schema],
      tableName: table,
      statementType: "CREATE",
    };
  }

  const table = extractTableName(sql);

  if (upper.startsWith("INSERT INTO")) {
    const row = parseInsert(sql);
    const previousCommitHash = lastCommitHashByTable.get(table) ?? "GENESIS";
    const payloadBase = {
      v: 2,
      op: "INSERT",
      table,
      row,
      previousCommitHash,
      ts: Date.now(),
    };
    const currentCommitHash = hashHex(JSON.stringify(payloadBase));
    const payload = JSON.stringify({ ...payloadBase, currentCommitHash });
    lastCommitHashByTable.set(table, currentCommitHash);

    return {
      target: `${params.packageId}::${moduleName}::insert`,
      arguments: [hashHex(`row:${payload}`), payload, hashHex(`index:${table}:${row.id ?? ""}`)],
      tableName: table,
      statementType: "INSERT",
    };
  }

  if (upper.startsWith("UPDATE")) {
    const { setField, setValue, whereField, whereValue } = parseUpdate(sql);
    const previousCommitHash = lastCommitHashByTable.get(table) ?? "GENESIS";
    const payloadBase = {
      v: 2,
      op: "UPDATE",
      table,
      set: { [setField]: setValue },
      where: { field: whereField, value: whereValue },
      previousCommitHash,
      ts: Date.now(),
    };
    const currentCommitHash = hashHex(JSON.stringify(payloadBase));
    const payload = JSON.stringify({ ...payloadBase, currentCommitHash });
    lastCommitHashByTable.set(table, currentCommitHash);

    return {
      target: `${params.packageId}::${moduleName}::update`,
      arguments: [hashHex(`row:${payload}`), payload, hashHex(`index:${table}:${whereField}:${whereValue}`)],
      tableName: table,
      statementType: "UPDATE",
    };
  }

  if (upper.startsWith("DELETE FROM")) {
    const { whereField, whereValue } = parseDelete(sql);
    const previousCommitHash = lastCommitHashByTable.get(table) ?? "GENESIS";
    const payloadBase = {
      v: 2,
      op: "DELETE",
      table,
      where: { field: whereField, value: whereValue },
      previousCommitHash,
      ts: Date.now(),
    };
    const currentCommitHash = hashHex(JSON.stringify(payloadBase));
    const payload = JSON.stringify({ ...payloadBase, currentCommitHash });
    lastCommitHashByTable.set(table, currentCommitHash);

    return {
      target: `${params.packageId}::${moduleName}::delete`,
      arguments: [hashHex(`row:${payload}`), payload, hashHex(`index:${table}:${whereField}:${whereValue}`)],
      tableName: table,
      statementType: "DELETE",
    };
  }

  throw new Error(`Unsupported on-chain statement: ${sql}`);
}

function hashHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function extractTableName(sql: string): string {
  const upper = sql.toUpperCase();

  if (upper.startsWith("INSERT INTO")) {
    const m = sql.match(/INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    if (!m) throw new Error(`Unsupported INSERT syntax: ${sql}`);
    return m[1];
  }

  if (upper.startsWith("UPDATE")) {
    const m = sql.match(/UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    if (!m) throw new Error(`Unsupported UPDATE syntax: ${sql}`);
    return m[1];
  }

  if (upper.startsWith("DELETE FROM")) {
    const m = sql.match(/DELETE FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    if (!m) throw new Error(`Unsupported DELETE syntax: ${sql}`);
    return m[1];
  }

  throw new Error(`Unable to extract table name from SQL: ${sql}`);
}

function parseInsert(sql: string): Record<string, string | number | boolean | null> {
  const m = sql.match(/INSERT INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\((.+)\)\s*VALUES\s*\((.+)\)/i);
  if (!m) throw new Error(`Unsupported INSERT syntax: ${sql}`);
  const cols = m[1].split(",").map((c) => c.trim());
  const vals = smartSplit(m[2]).map((v) => castValue(v));
  if (cols.length !== vals.length) throw new Error(`INSERT column/value mismatch`);
  const row: Record<string, string | number | boolean | null> = {};
  cols.forEach((c, i) => (row[c] = vals[i]));
  return row;
}

function parseUpdate(sql: string): { setField: string; setValue: string | number | boolean | null; whereField: string; whereValue: string } {
  const m = sql.match(/UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
  if (!m) throw new Error(`Unsupported UPDATE syntax: ${sql}`);
  return {
    setField: m[1].trim(),
    setValue: castValue(m[2].trim()),
    whereField: m[3].trim(),
    whereValue: trimQuoted(m[4].trim()),
  };
}

function parseDelete(sql: string): { whereField: string; whereValue: string } {
  const m = sql.match(/DELETE FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
  if (!m) throw new Error(`Unsupported DELETE syntax: ${sql}`);
  return {
    whereField: m[1].trim(),
    whereValue: trimQuoted(m[2].trim()),
  };
}

function castValue(raw: string): string | number | boolean | null {
  const v = trimQuoted(raw.trim());
  if (v.toLowerCase() === "null") return null;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (!Number.isNaN(Number(v)) && v !== "") return Number(v);
  return v;
}

function smartSplit(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote = "";
  for (const ch of input) {
    if ((ch === "'" || ch === '"') && !quote) {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === quote) {
      quote = "";
      buf += ch;
      continue;
    }
    if (ch === "," && !quote) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function trimQuoted(v: string): string {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}
