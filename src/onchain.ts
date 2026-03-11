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
    const payload = JSON.stringify({ v: 1, op: "INSERT", table, row });
    return {
      target: `${params.packageId}::${moduleName}::insert`,
      arguments: [hashHex(`row:${payload}`), payload, hashHex(`index:${table}:${row.id ?? ""}`)],
      tableName: table,
      statementType: "INSERT",
    };
  }

  if (upper.startsWith("UPDATE")) {
    const { setField, setValue, whereField, whereValue } = parseUpdate(sql);
    const payload = JSON.stringify({
      v: 1,
      op: "UPDATE",
      table,
      set: { [setField]: setValue },
      where: { field: whereField, value: whereValue },
    });
    return {
      target: `${params.packageId}::${moduleName}::update`,
      arguments: [hashHex(`row:${payload}`), payload, hashHex(`index:${table}:${whereField}:${whereValue}`)],
      tableName: table,
      statementType: "UPDATE",
    };
  }

  if (upper.startsWith("DELETE FROM")) {
    const { whereField, whereValue } = parseDelete(sql);
    const payload = JSON.stringify({
      v: 1,
      op: "DELETE",
      table,
      where: { field: whereField, value: whereValue },
    });
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
