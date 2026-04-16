import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { SuiClient } from "@mysten/sui/client";
import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { decode as decodeCbor, encode as encodeCbor } from "cbor-x";
import {
  convertTypedValue,
  deserializeTypedValue,
  fromJs,
  fromStorage,
  normalizeRuntimeTypeName,
  serializeTypedValue,
  SqlRuntimeType,
  typedValueComparator,
  typedValueOperators,
} from "./types.js";
import type { OnchainQueryExecutor, OnchainQueryRequest, QueryResult, SerializedTypedValue, SqlPrimitive, SqlRow, SqlTypedValue } from "./types.js";
import { evaluateScalarFunctionPrimitive, SCALAR_FUNCTIONS_PRIMITIVE } from "./functions/mod.js";

type Payload =
  | {
      v: number;
      op: "INSERT";
      table: string;
      row: SqlRow;
      previousCommitHash?: string;
      currentCommitHash?: string;
      ts?: number;
    }
  | {
      v: number;
      op: "UPDATE";
      table: string;
      set: Record<string, string | number | boolean | null>;
      where: { field: string; value: string };
      previousCommitHash?: string;
      currentCommitHash?: string;
      ts?: number;
    }
  | {
      v: number;
      op: "DELETE";
      table: string;
      where: { field: string; value: string };
      previousCommitHash?: string;
      currentCommitHash?: string;
      ts?: number;
    };

export type ReplayPayload = Payload;

type Cursor = { txDigest: string; eventSeq: string } | null | undefined;
type CompareOp = "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=" | "IN" | "NOT_IN" | "BETWEEN" | "NOT_BETWEEN" | "LIKE" | "NOT_LIKE" | "IS_NULL" | "IS_NOT_NULL";
type LogicOp = "AND" | "OR";
type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";
type ComparePredicate = "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=";

const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type WhereClause = {
  logic?: LogicOp;
  field: string;
  op: CompareOp;
  value?: SqlPrimitive;
  values?: SqlPrimitive[];
  valueExpr?: string;
  valueExprs?: string[];
  likeEscape?: string;
};

type ReplayCache = {
  cursor: Cursor;
  rows: SqlRow[];
  seenDigests: Set<string>;
  initialized: boolean;
  lastCommitHash: string;
  invalidPayloads: number;
};

export type ReplayCacheFormat = "json" | "msgpack" | "cbor";

export type PersistedReplayCacheEntry = {
  cursor: Cursor;
  rows: SqlRow[];
  seenDigests: string[];
  initialized: boolean;
  lastCommitHash: string;
  invalidPayloads: number;
};

export type PersistedReplayCache = Record<string, PersistedReplayCacheEntry>;

type EncodedSqlPrimitive =
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: string }
  | { kind: "string"; value: string };

type EncodedSqlRow = Record<string, EncodedSqlPrimitive | SerializedTypedValue>;

type PersistedReplayCacheEntryEncoded = Omit<PersistedReplayCacheEntry, "rows"> & {
  rows: EncodedSqlRow[];
};

type PersistedReplayCacheEnvelope = {
  version: 1;
  encoding: "sql-primitive-v1";
  entries: Record<string, PersistedReplayCacheEntryEncoded>;
};

type PersistedReplayCacheEnvelopeV2 = {
  version: 2;
  encoding: "typed-value-v1";
  entries: Record<string, PersistedReplayCacheEntryEncoded>;
};

export interface ReplayQueryExecutorOptions {
  client: SuiClient;
  packageId: string;
  tableRegistry?: Map<string, string> | Record<string, string>;
  ownerAddress?: string;
  autoDiscoverTables?: boolean;
  pageSize?: number;
  cacheFilePath?: string;
  cacheFormat?: ReplayCacheFormat;
}

function encodeSqlPrimitive(value: SqlPrimitive): EncodedSqlPrimitive {
  if (value === null) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "string", value: String(value) };
    return { kind: "number", value: value.toString() };
  }
  return { kind: "string", value };
}

function decodeSqlPrimitive(value: unknown): SqlPrimitive {
  if (value && typeof value === "object" && "kind" in (value as Record<string, unknown>)) {
    const cell = value as { kind?: unknown; value?: unknown };
    if (cell.kind === "null") return null;
    if (cell.kind === "boolean") return Boolean(cell.value);
    if (cell.kind === "number") {
      const raw = String(cell.value ?? "");
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (cell.kind === "string") return String(cell.value ?? "");
  }

  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") {
    if (value < MIN_SAFE_INTEGER_BIGINT || value > MAX_SAFE_INTEGER_BIGINT) return value.toString();
    return Number(value);
  }
  return String(value);
}

function encodeSqlRow(row: SqlRow): EncodedSqlRow {
  const out: EncodedSqlRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = serializeTypedValue(fromStorage((v ?? null) as SqlPrimitive, undefined, {}, `replay.cache.encode:${k}`));
  }
  return out;
}

function decodeSqlRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && "type" in (v as Record<string, unknown>)) {
      try {
        out[k] = deserializeTypedValue(v as SerializedTypedValue).value;
        continue;
      } catch {
        // Fallback to primitive decoder for malformed cells.
      }
    }
    out[k] = decodeSqlPrimitive(v);
  }
  return out;
}

function encodePersistedReplayCache(data: PersistedReplayCache): PersistedReplayCacheEnvelopeV2 {
  const entries: Record<string, PersistedReplayCacheEntryEncoded> = {};
  for (const [tableId, entry] of Object.entries(data)) {
    entries[tableId] = {
      cursor: entry.cursor,
      rows: entry.rows.map((row) => encodeSqlRow(row)),
      seenDigests: [...entry.seenDigests],
      initialized: entry.initialized,
      lastCommitHash: entry.lastCommitHash,
      invalidPayloads: entry.invalidPayloads,
    };
  }
  return { version: 2, encoding: "typed-value-v1", entries };
}

function decodePersistedReplayCache(payload: unknown): PersistedReplayCache {
  if (
    payload
    && typeof payload === "object"
    && (payload as Record<string, unknown>).version === 2
    && (payload as Record<string, unknown>).encoding === "typed-value-v1"
    && typeof (payload as Record<string, unknown>).entries === "object"
    && (payload as Record<string, unknown>).entries !== null
  ) {
    const entries = (payload as PersistedReplayCacheEnvelopeV2).entries;
    const out: PersistedReplayCache = {};
    for (const [tableId, entry] of Object.entries(entries)) {
      out[tableId] = {
        cursor: entry.cursor,
        rows: entry.rows.map((row) => decodeSqlRow(row as Record<string, unknown>)),
        seenDigests: [...entry.seenDigests],
        initialized: entry.initialized,
        lastCommitHash: entry.lastCommitHash,
        invalidPayloads: entry.invalidPayloads,
      };
    }
    return out;
  }

  if (
    payload
    && typeof payload === "object"
    && (payload as Record<string, unknown>).version === 1
    && (payload as Record<string, unknown>).encoding === "sql-primitive-v1"
    && typeof (payload as Record<string, unknown>).entries === "object"
    && (payload as Record<string, unknown>).entries !== null
  ) {
    const entries = (payload as PersistedReplayCacheEnvelope).entries;
    const out: PersistedReplayCache = {};
    for (const [tableId, entry] of Object.entries(entries)) {
      out[tableId] = {
        cursor: entry.cursor,
        rows: entry.rows.map((row) => decodeSqlRow(row as Record<string, unknown>)),
        seenDigests: [...entry.seenDigests],
        initialized: entry.initialized,
        lastCommitHash: entry.lastCommitHash,
        invalidPayloads: entry.invalidPayloads,
      };
    }
    return out;
  }

  // Backward compatibility: previous snapshots stored plain SqlPrimitive rows.
  const legacy = (payload ?? {}) as Record<string, PersistedReplayCacheEntry>;
  const out: PersistedReplayCache = {};
  for (const [tableId, entry] of Object.entries(legacy)) {
    const rows = Array.isArray(entry.rows)
      ? entry.rows.map((row) => decodeSqlRow((row ?? {}) as Record<string, unknown>))
      : [];
    out[tableId] = {
      cursor: entry.cursor ?? null,
      rows,
      seenDigests: Array.isArray(entry.seenDigests) ? entry.seenDigests.map((d) => String(d)) : [],
      initialized: Boolean(entry.initialized),
      lastCommitHash: String(entry.lastCommitHash ?? "GENESIS"),
      invalidPayloads: Number.isFinite(entry.invalidPayloads) ? entry.invalidPayloads : 0,
    };
  }
  return out;
}

function inferReplayCacheFormat(path?: string): ReplayCacheFormat {
  if (!path) return "json";
  const p = path.toLowerCase();
  if (p.endsWith(".msgpack") || p.endsWith(".mpack") || p.endsWith(".mpk")) return "msgpack";
  if (p.endsWith(".cbor") || p.endsWith(".cb")) return "cbor";
  return "json";
}

export function serializeReplayCache(data: PersistedReplayCache, format: ReplayCacheFormat): Uint8Array {
  const encoded = encodePersistedReplayCache(data);
  if (format === "msgpack") return encodeMsgpack(encoded);
  if (format === "cbor") return encodeCbor(encoded);
  return new TextEncoder().encode(JSON.stringify(encoded));
}

export function deserializeReplayCache(blob: Uint8Array, format: ReplayCacheFormat): PersistedReplayCache {
  if (format === "msgpack") return decodePersistedReplayCache(decodeMsgpack(blob));
  if (format === "cbor") return decodePersistedReplayCache(decodeCbor(blob));
  return decodePersistedReplayCache(JSON.parse(new TextDecoder().decode(blob)));
}

export function transcodeReplayCache(
  blob: Uint8Array,
  from: ReplayCacheFormat,
  to: ReplayCacheFormat,
): Uint8Array {
  const decoded = deserializeReplayCache(blob, from);
  return serializeReplayCache(decoded, to);
}

function trimQuoted(raw: string): string {
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function castValue(raw: string): SqlPrimitive {
  const v = trimQuoted(raw.trim());
  if (v.toLowerCase() === "null") return null;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (/^[+-]?\d+$/.test(v)) {
    try {
      const parsed = BigInt(v);
      if (parsed < MIN_SAFE_INTEGER_BIGINT || parsed > MAX_SAFE_INTEGER_BIGINT) return v;
      return Number(v);
    } catch {
      return v;
    }
  }
  if (!Number.isNaN(Number(v)) && v !== "") return Number(v);
  return v;
}

/**
 * Parse a function call expression like "FUNC(a, b, c)" or "FUNC(a, F2(b))".
 * Returns { name, args } where args is an array of argument strings (not evaluated).
 * Returns null if expr is not a valid function call (no matching parens, etc.)
 */
function parseFunctionCall(expr: string): { name: string; args: string[] } | null {
  const trimmed = expr.trim();
  const openParen = trimmed.indexOf("(");
  if (openParen <= 0) return null;
  const name = trimmed.slice(0, openParen);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/i.test(name)) return null;
  // Find the matching closing paren
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) { closeParen = i; break; }
    }
  }
  if (closeParen === -1) return null;
  const inner = trimmed.slice(openParen + 1, closeParen);
  // Parse arguments with depth-aware split
  const args: string[] = [];
  let buf = "";
  let quote = "";
  for (const ch of inner) {
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
    if (ch === "," && !quote && depth === 0) {
      args.push(buf.trim());
      buf = "";
      continue;
    }
    if (ch === "(") { depth++; }
    else if (ch === ")") { depth--; }
    buf += ch;
  }
  if (buf.trim() || args.length > 0) args.push(buf.trim());
  return { name, args };
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

function splitWhereTokens(whereExpr: string): string[] {
  const src = whereExpr.trim();
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  let pendingBetween = false;
  let word = "";

  const flush = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  };

  const flushWord = () => {
    if (!word) return;
    if (word.toUpperCase() === "BETWEEN") pendingBetween = true;
    word = "";
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;

    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      flushWord();
      buf += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      flushWord();
      buf += ch;
      continue;
    }

    if (/\s/.test(ch)) {
      flushWord();
    } else {
      word += ch;
    }

    if (depth === 0) {
      const rest = src.slice(i).toUpperCase();
      if (rest.startsWith(" AND ")) {
        if (pendingBetween) {
          pendingBetween = false;
        } else {
          flush();
          out.push("AND");
          i += 4;
          continue;
        }
      }
      if (rest.startsWith(" OR ")) {
        flush();
        out.push("OR");
        i += 3;
        continue;
      }
    }

    buf += ch;
  }

  flush();
  return out;
}

function trimOuterParentheses(expr: string): string {
  let out = expr.trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    let depth = 0;
    let valid = true;
    let quote = "";
    for (let i = 0; i < out.length; i++) {
      const ch = out[i]!;
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && i < out.length - 1) {
        valid = false;
        break;
      }
    }
    if (!valid) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

function parseFieldExpr(input: string): { field: string; valueExpr?: string } {
  const s = input.trim();
  const cm = s.match(/^(.+)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_\.]*)$/i);
  if (cm) return { field: cm[2]!, valueExpr: cm[1]!.trim() };
  if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(s)) return { field: s };
  return { field: s, valueExpr: s };
}

function evalExpr(row: SqlRow, exprRaw: string): SqlPrimitive | undefined {
  const expr = trimOuterParentheses(exprRaw.trim());

  const caseMatch = expr.match(/^CASE\s+WHEN\s+(.+?)\s+THEN\s+(.+?)\s+ELSE\s+(.+?)\s+END$/i);
  if (caseMatch) {
    const condRows = applyWhereClauses([row], parseWhere(caseMatch[1]!));
    const branch = condRows.length ? caseMatch[2]! : caseMatch[3]!;
    return evalExpr(row, branch);
  }

  if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(expr)) return row[expr] as SqlPrimitive | undefined;

  const lit = castValue(expr);
  if (expr.startsWith("'") || expr.startsWith('"') || typeof lit !== "string") return lit;

  // Try function registry before tokenizing (handles all registered functions)
  const fnCall = parseFunctionCall(expr);
  if (fnCall) {
    const fnName = fnCall.name.toUpperCase();
    if (SCALAR_FUNCTIONS_PRIMITIVE[fnName]) {
      const args = fnCall.args.map((arg) => evalExpr(row, arg)).filter((a): a is SqlPrimitive => a !== undefined);
      return evaluateScalarFunctionPrimitive(fnName, args, { row });
    }
  }

  const toks = tokenizeExpr(expr);
  if (!toks.length) return null;
  return evalRpn(row, toRpn(toks));
}

function tokenizeExpr(expr: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (quote) {
      buf += ch;
      if (ch === quote) {
        out.push(buf);
        buf = "";
        quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (buf.trim()) out.push(buf.trim());
      buf = ch;
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    if ("()+-*/%~".includes(ch)) {
      if (buf.trim()) out.push(buf.trim());
      out.push(ch);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function toRpn(tokens: string[]): string[] {
  const out: string[] = [];
  const ops: string[] = [];
  const pri: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3, "u~": 3 };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "(") {
      ops.push(t);
      continue;
    }
    if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      ops.pop();
      continue;
    }
    if (["+", "-", "*", "/", "%", "~"].includes(t)) {
      const prev = tokens[i - 1];
      const unary = (t === "-" || t === "~") && (i === 0 || prev === "(" || ["+", "-", "*", "/", "%", "~"].includes(prev!));
      const op = unary ? `u${t}` : t;
      while (ops.length && pri[ops[ops.length - 1]!] >= pri[op]) out.push(ops.pop()!);
      ops.push(op);
      continue;
    }
    out.push(t);
  }

  while (ops.length) out.push(ops.pop()!);
  return out;
}

function evalRpn(row: SqlRow, rpn: string[]): SqlPrimitive | undefined {
  const st: Array<SqlPrimitive | undefined> = [];
  for (const t of rpn) {
    if (t === "u-") {
      const a = st.pop();
      if (a == null) st.push(null);
      else {
        const n = Number(a);
        st.push(Number.isFinite(n) ? -n : null);
      }
      continue;
    }
    if (t === "u~") {
      const a = st.pop();
      if (a == null) st.push(null);
      else {
        const n = Number(a);
        st.push(Number.isFinite(n) ? ~n : null);
      }
      continue;
    }
    if (["+", "-", "*", "/", "%"].includes(t)) {
      const b = st.pop();
      const a = st.pop();
      if (a == null || b == null) {
        st.push(null);
        continue;
      }
      const an = Number(a);
      const bn = Number(b);
      if (!Number.isFinite(an) || !Number.isFinite(bn)) {
        st.push(null);
        continue;
      }
      if (t === "+") st.push(an + bn);
      else if (t === "-") st.push(an - bn);
      else if (t === "*") st.push(an * bn);
      else if (t === "/") st.push(bn === 0 ? null : an / bn);
      else st.push(bn === 0 ? null : an % bn);
      continue;
    }

    if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(t)) st.push(row[t] as SqlPrimitive | undefined);
    else st.push(castValue(t));
  }
  return st.length ? st[st.length - 1] : null;
}

function findTopLevelComparator(expr: string): { left: string; op: ComparePredicate; right: string } | null {
  let depth = 0;
  let quote = "";
  let word = "";
  let caseDepth = 0;

  const flushWord = () => {
    if (!word) return;
    const u = word.toUpperCase();
    if (u === "CASE") caseDepth++;
    else if (u === "END" && caseDepth > 0) caseDepth--;
    word = "";
  };

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;

    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      flushWord();
      quote = ch;
      continue;
    }

    if (/[a-zA-Z0-9_]/.test(ch)) word += ch;
    else flushWord();

    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || caseDepth !== 0) continue;

    const two = expr.slice(i, i + 2);
    if ([">=", "<=", "!=", "<>"] .includes(two)) {
      return { left: expr.slice(0, i).trim(), op: two as ComparePredicate, right: expr.slice(i + 2).trim() };
    }
    if (["=", ">", "<"].includes(ch)) {
      return { left: expr.slice(0, i).trim(), op: ch as ComparePredicate, right: expr.slice(i + 1).trim() };
    }
  }

  return null;
}

function likeToRegex(patternRaw: string, escapeChar?: string): string {
  const escaped = /[.*+?^${}()|[\]\\]/;
  let out = "";

  for (let i = 0; i < patternRaw.length; i++) {
    const ch = patternRaw[i]!;
    if (escapeChar && ch === escapeChar) {
      const next = patternRaw[i + 1];
      if (next !== undefined) {
        out += escaped.test(next) ? `\\${next}` : next;
        i++;
        continue;
      }
    }

    if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += escaped.test(ch) ? `\\${ch}` : ch;
  }

  return `^${out}$`;
}

function parseAtomicWhereClause(token: string): WhereClause {
  const expr = trimOuterParentheses(token.trim());

  const nullMatch = expr.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (nullMatch) {
    const left = parseFieldExpr(nullMatch[1]!);
    return {
      field: left.field,
      valueExpr: left.valueExpr,
      op: nullMatch[2] ? "IS_NOT_NULL" : "IS_NULL",
    };
  }

  const betweenMatch = expr.match(/^(.+?)\s+(NOT\s+)?BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
  if (betweenMatch) {
    const left = parseFieldExpr(betweenMatch[1]!);
    return {
      field: left.field,
      valueExpr: left.valueExpr,
      op: betweenMatch[2] ? "NOT_BETWEEN" : "BETWEEN",
      valueExprs: [betweenMatch[3]!.trim(), betweenMatch[4]!.trim()],
    };
  }

  const likeMatch = expr.match(/^(.+?)\s+(NOT\s+)?LIKE\s+(.+?)(?:\s+ESCAPE\s+(.+))?$/i);
  if (likeMatch) {
    const left = parseFieldExpr(likeMatch[1]!);
    const escRaw = likeMatch[4] ? trimQuoted(likeMatch[4].trim()) : undefined;
    const esc = escRaw && escRaw.length > 0 ? escRaw[0] : undefined;
    return {
      field: left.field,
      valueExpr: left.valueExpr,
      op: likeMatch[2] ? "NOT_LIKE" : "LIKE",
      valueExprs: [likeMatch[3]!.trim()],
      likeEscape: esc,
    };
  }

  const inMatch = expr.match(/^(.+?)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
  if (inMatch) {
    const left = parseFieldExpr(inMatch[1]!);
    return {
      field: left.field,
      valueExpr: left.valueExpr,
      op: inMatch[2] ? "NOT_IN" : "IN",
      valueExprs: smartSplit(inMatch[3]).map((v) => v.trim()),
    };
  }

  const cmp = findTopLevelComparator(expr);
  if (cmp) {
    const left = parseFieldExpr(cmp.left);
    return {
      field: left.field,
      valueExpr: left.valueExpr,
      op: cmp.op as CompareOp,
      valueExprs: [cmp.right],
    };
  }

  throw new Error(`Unsupported WHERE expression: ${token}`);
}

function parseWhere(whereExpr: string): WhereClause[] {
  const tokens = splitWhereTokens(whereExpr);
  const out: WhereClause[] = [];
  let pendingLogic: LogicOp | undefined;

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (upper === "AND" || upper === "OR") {
      pendingLogic = upper;
      continue;
    }

    const clause = parseAtomicWhereClause(token);
    clause.logic = pendingLogic;
    out.push(clause);
    pendingLogic = undefined;
  }

  return out;
}

function normalizeComparableTypedPair(
  left: SqlPrimitive | undefined,
  right: SqlPrimitive | undefined,
  sourceContext: string,
): [SqlTypedValue, SqlTypedValue] {
  let leftTyped = fromStorage((left ?? null) as SqlPrimitive, undefined, {}, `${sourceContext}.left`);
  let rightTyped = fromJs((right ?? null) as SqlPrimitive, undefined, {}, `${sourceContext}.right`);
  if (leftTyped.value === null || rightTyped.value === null || leftTyped.type === rightTyped.type) {
    return [leftTyped, rightTyped];
  }

  try {
    rightTyped = convertTypedValue(rightTyped, leftTyped.type, {
      mode: "implicit",
      sourceContext: `${sourceContext}.right->left`,
    });
    return [leftTyped, rightTyped];
  } catch {
    // Try opposite conversion direction first; final fallback is TEXT/TEXT compare.
  }

  try {
    leftTyped = convertTypedValue(leftTyped, rightTyped.type, {
      mode: "implicit",
      sourceContext: `${sourceContext}.left->right`,
    });
    return [leftTyped, rightTyped];
  } catch {
    // Convert both sides to TEXT for a deterministic typed fallback path.
  }

  leftTyped = convertTypedValue(leftTyped, SqlRuntimeType.TEXT, {
    mode: "explicit",
    sourceContext: `${sourceContext}.left->text`,
  });
  rightTyped = convertTypedValue(rightTyped, SqlRuntimeType.TEXT, {
    mode: "explicit",
    sourceContext: `${sourceContext}.right->text`,
  });
  return [leftTyped, rightTyped];
}

function typedEquals(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined, sourceContext: string): boolean | null {
  const [leftTyped, rightTyped] = normalizeComparableTypedPair(left, right, sourceContext);
  return typedValueComparator.eq(leftTyped, rightTyped);
}

function compareByOp(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined, op: ComparePredicate): TruthValue {
  const toReplayTruth = (value: boolean | null): TruthValue => {
    if (value === null) return "UNKNOWN";
    return value ? "TRUE" : "FALSE";
  };
  const [leftTyped, rightTyped] = normalizeComparableTypedPair(left, right, `replay.predicate.compare.${op}`);

  switch (op) {
    case "=":
      return toReplayTruth(typedValueComparator.eq(leftTyped, rightTyped));
    case "!=":
    case "<>": {
      const eq = typedValueComparator.eq(leftTyped, rightTyped);
      return toReplayTruth(eq === null ? null : !eq);
    }
    case ">":
      return toReplayTruth(typedValueComparator.gt(leftTyped, rightTyped));
    case "<":
      return toReplayTruth(typedValueComparator.lt(leftTyped, rightTyped));
    case ">=":
      return toReplayTruth(typedValueComparator.gte(leftTyped, rightTyped));
    case "<=":
      return toReplayTruth(typedValueComparator.lte(leftTyped, rightTyped));
    default:
      return "FALSE";
  }
}

function tvNot(v: TruthValue): TruthValue {
  if (v === "TRUE") return "FALSE";
  if (v === "FALSE") return "TRUE";
  return "UNKNOWN";
}

function tvAnd(a: TruthValue, b: TruthValue): TruthValue {
  if (a === "FALSE" || b === "FALSE") return "FALSE";
  if (a === "TRUE" && b === "TRUE") return "TRUE";
  return "UNKNOWN";
}

function tvOr(a: TruthValue, b: TruthValue): TruthValue {
  if (a === "TRUE" || b === "TRUE") return "TRUE";
  if (a === "FALSE" && b === "FALSE") return "FALSE";
  return "UNKNOWN";
}

function evaluateClause(row: SqlRow, clause: WhereClause): TruthValue {
  const left = clause.valueExpr ? evalExpr(row, clause.valueExpr) : (row[clause.field] as SqlPrimitive | undefined);

  if (clause.op === "IN" || clause.op === "NOT_IN") {
    const values = (clause.valueExprs?.length ? clause.valueExprs.map((v) => evalExpr(row, v) ?? null) : clause.values) ?? [];
    let hasUnknown = false;
    for (const v of values) {
      const t = compareByOp(left, v, "=");
      if (t === "TRUE") return clause.op === "IN" ? "TRUE" : "FALSE";
      if (t === "UNKNOWN") hasUnknown = true;
    }
    if (hasUnknown) return "UNKNOWN";
    return clause.op === "IN" ? "FALSE" : "TRUE";
  }

  if (clause.op === "BETWEEN" || clause.op === "NOT_BETWEEN") {
    const lower = clause.valueExprs?.[0] ? evalExpr(row, clause.valueExprs[0]) : clause.values?.[0];
    const upper = clause.valueExprs?.[1] ? evalExpr(row, clause.valueExprs[1]) : clause.values?.[1];
    const inRange = tvAnd(compareByOp(left, lower, ">="), compareByOp(left, upper, "<="));
    return clause.op === "BETWEEN" ? inRange : tvNot(inRange);
  }

  const right = clause.valueExprs?.[0] ? evalExpr(row, clause.valueExprs[0]) : clause.value;
  switch (clause.op) {
    case "=":
    case "!=":
    case "<>":
    case ">":
    case "<":
    case ">=":
    case "<=":
      return compareByOp(left, right, clause.op as ComparePredicate);
    case "LIKE":
    case "NOT_LIKE": {
      if (left == null || right == null) return "UNKNOWN";
      const leftTyped = convertTypedValue(
        fromStorage((left ?? null) as SqlPrimitive, undefined, {}, "replay.predicate.like.left"),
        SqlRuntimeType.TEXT,
        { mode: "explicit", sourceContext: "replay.predicate.like.left" },
      );
      const rightTyped = convertTypedValue(
        fromJs((right ?? null) as SqlPrimitive, undefined, {}, "replay.predicate.like.right"),
        SqlRuntimeType.TEXT,
        { mode: "explicit", sourceContext: "replay.predicate.like.right" },
      );
      const regex = likeToRegex(String(rightTyped.value ?? ""), clause.likeEscape);
      const matched = new RegExp(regex, "i").test(String(leftTyped.value ?? ""));
      const tv: TruthValue = matched ? "TRUE" : "FALSE";
      return clause.op === "LIKE" ? tv : tvNot(tv);
    }
    case "IS_NULL":
      return left === null || left === undefined ? "TRUE" : "FALSE";
    case "IS_NOT_NULL":
      return left === null || left === undefined ? "FALSE" : "TRUE";
    default:
      return "FALSE";
  }
}

function applyWhereClauses(rows: SqlRow[], clauses: WhereClause[]): SqlRow[] {
  return rows.filter((row) => {
    let acc: TruthValue | null = null;
    for (const c of clauses) {
      const matched = evaluateClause(row, c);
      if (acc === null) {
        acc = matched;
      } else if (c.logic === "OR") {
        acc = tvOr(acc, matched);
      } else {
        acc = tvAnd(acc, matched);
      }
    }
    return acc === "TRUE";
  });
}

function applyOrder(rows: SqlRow[], orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>): SqlRow[] {
  if (!orderByList?.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { field, direction } of orderByList) {
      const cmp = compareForOrder(a[field], b[field], direction);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function compareForOrder(
  a: SqlPrimitive | undefined,
  b: SqlPrimitive | undefined,
  direction: "ASC" | "DESC",
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const [leftTyped, rightTyped] = normalizeComparableTypedPair(a, b, "replay.order.key");
  const lt = typedValueComparator.lt(leftTyped, rightTyped);
  if (lt === true) return direction === "DESC" ? 1 : -1;
  const gt = typedValueComparator.gt(leftTyped, rightTyped);
  if (gt === true) return direction === "DESC" ? -1 : 1;
  return 0;
}

function applyPage(rows: SqlRow[], offset?: number, limit?: number): SqlRow[] {
  const from = offset ?? 0;
  const size = limit ?? rows.length;
  return rows.slice(from, from + size);
}

function computeAggregateRow(
  rows: SqlRow[],
  aggregate: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "TOTAL" | "GROUP_CONCAT",
  aggregateField?: string,
): SqlRow {
  if (aggregate === "COUNT") {
    if (!aggregateField || aggregateField === "*") return { count: rows.length };
    return {
      count: rows.filter((r) => r[aggregateField] !== null && r[aggregateField] !== undefined).length,
    };
  }

  if (!aggregateField || aggregateField === "*") {
    throw new Error(`${aggregate} requires a numeric field`);
  }

  const typedNums = rows
    .map((r) => r[aggregateField])
    .filter((v) => v !== null && v !== undefined)
    .map((v) => fromStorage((v ?? null) as SqlPrimitive, undefined, {}, `replay.aggregate.source:${aggregateField}`))
    .map((typed) => {
      try {
        return convertTypedValue(typed, SqlRuntimeType.DOUBLE, {
          mode: "explicit",
          sourceContext: `replay.aggregate.numeric:${aggregateField}`,
        });
      } catch {
        return null;
      }
    })
    .filter((typed): typed is NonNullable<typeof typed> => typed !== null && typed.value !== null);

  if (aggregate === "SUM") {
    if (!typedNums.length) return { sum: null };
    let state = typedNums[0]!;
    for (let i = 1; i < typedNums.length; i++) {
      state = typedValueOperators.add(state, typedNums[i]!);
    }
    return { sum: state.value as SqlPrimitive };
  }

  if (aggregate === "AVG") {
    if (!typedNums.length) return { avg: null };
    let sumState = typedNums[0]!;
    for (let i = 1; i < typedNums.length; i++) {
      sumState = typedValueOperators.add(sumState, typedNums[i]!);
    }
    const divisor = fromJs(typedNums.length, SqlRuntimeType.INT, {}, `replay.aggregate.avg.divisor:${aggregateField}`);
    const avg = typedValueOperators.div(sumState, divisor);
    return { avg: avg.value as SqlPrimitive };
  }

  if (aggregate === "MIN") {
    if (!typedNums.length) return { min: null };
    let state = typedNums[0]!;
    for (let i = 1; i < typedNums.length; i++) {
      const lt = typedValueComparator.lt(typedNums[i]!, state);
      if (lt === true) state = typedNums[i]!;
    }
    return { min: state.value as SqlPrimitive };
  }

  if (aggregate === "TOTAL") {
    // TOTAL: like SUM but returns 0.0 for empty set instead of null
    if (!typedNums.length) return { total: 0.0 };
    let total = 0;
    for (const typed of typedNums) {
      total += typeof typed.value === "number" ? typed.value : Number(typed.value) || 0;
    }
    return { total };
  }

  if (aggregate === "GROUP_CONCAT") {
    const concatValues = rows
      .map((r) => r[aggregateField!])
      .filter((v) => v !== null && v !== undefined);
    const concatenated = concatValues.map((v) => String(v)).join(", ");
    return { group_concat: concatenated };
  }

  if (!typedNums.length) return { max: null };
  let state = typedNums[0]!;
  for (let i = 1; i < typedNums.length; i++) {
    const gt = typedValueComparator.gt(typedNums[i]!, state);
    if (gt === true) state = typedNums[i]!;
  }
  return { max: state.value as SqlPrimitive };
}

function groupRows(
  rows: SqlRow[],
  groupBy: string[],
  aggregate?: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "TOTAL" | "GROUP_CONCAT",
  aggregateField?: string,
): SqlRow[] {
  const buckets = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const key = groupBy.map((g) => encodeReplayTypedKey(row[g] as SqlPrimitive | undefined, `replay.group:${g}`)).join("||");
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const out: SqlRow[] = [];
  for (const bucketRows of buckets.values()) {
    const row: SqlRow = {};
    for (const g of groupBy) row[g] = bucketRows[0]?.[g] ?? null;
    if (aggregate) Object.assign(row, computeAggregateRow(bucketRows, aggregate, aggregateField));
    out.push(row);
  }
  return out;
}

function joinRows(
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL",
  leftTable: string,
  leftRows: SqlRow[],
  rightTable: string,
  rightRows: SqlRow[],
  leftFieldExpr: string,
  rightFieldExpr: string,
): SqlRow[] {
  if (joinType === "RIGHT") {
    return joinRows("LEFT", rightTable, rightRows, leftTable, leftRows, rightFieldExpr, leftFieldExpr);
  }

  const leftField = leftFieldExpr.includes(".") ? leftFieldExpr.split(".")[1] : leftFieldExpr;
  const rightField = rightFieldExpr.includes(".") ? rightFieldExpr.split(".")[1] : rightFieldExpr;

  const out: SqlRow[] = [];
  const matchedRightIndexes = new Set<number>();
  for (const l of leftRows) {
    let matched = false;
    for (let ri = 0; ri < rightRows.length; ri++) {
      const r = rightRows[ri]!;
      const leftVal = l[leftField];
      const rightVal = r[rightField];
      if (!replayKeyEqual(leftVal, rightVal)) continue;
      matched = true;
      matchedRightIndexes.add(ri);
      const merged: SqlRow = {};
      for (const [k, v] of Object.entries(l)) {
        merged[k] = v;
        merged[`${leftTable}.${k}`] = v;
      }
      for (const [k, v] of Object.entries(r)) {
        merged[`${rightTable}.${k}`] = v;
        if (!(k in merged)) merged[k] = v;
      }
      out.push(merged);
    }

    if (!matched && (joinType === "LEFT" || joinType === "FULL")) {
      const merged: SqlRow = {};
      for (const [k, v] of Object.entries(l)) {
        merged[k] = v;
        merged[`${leftTable}.${k}`] = v;
      }
      out.push(merged);
    }
  }

  if (joinType === "FULL") {
    for (let ri = 0; ri < rightRows.length; ri++) {
      if (matchedRightIndexes.has(ri)) continue;
      const r = rightRows[ri]!;
      const merged: SqlRow = {};
      for (const [k, v] of Object.entries(r)) {
        merged[`${rightTable}.${k}`] = v;
        if (!(k in merged)) merged[k] = v;
      }
      out.push(merged);
    }
  }

  return out;
}

function pickFields(row: SqlRow, fields: string[] | ["*"]): SqlRow {
  if (fields.length === 1 && fields[0] === "*") return row;
  const out: SqlRow = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

function parsePayload(maybeJson: string): Payload | null {
  try {
    const parsed = JSON.parse(maybeJson) as Payload;
    if (!parsed || typeof parsed !== "object" || !("op" in parsed)) return null;
    if (parsed.op !== "INSERT" && parsed.op !== "UPDATE" && parsed.op !== "DELETE") return null;
    return parsed;
  } catch {
    return null;
  }
}

function hashHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function verifyPayloadChain(payload: Payload, expectedPreviousHash: string): boolean {
  if (!payload.currentCommitHash) return true;
  const previous = payload.previousCommitHash ?? "GENESIS";
  if (previous !== expectedPreviousHash) return false;

  const { currentCommitHash: _current, ...base } = payload;
  const expectedCurrent = hashHex(JSON.stringify(base));
  return expectedCurrent === payload.currentCommitHash;
}

function encodeReplayTypedKey(value: SqlPrimitive | undefined, sourceContext: string): string {
  const typed = fromStorage((value ?? null) as SqlPrimitive, undefined, {}, sourceContext);
  return JSON.stringify({ type: typed.type, value: typed.value });
}

function replayKeyEqual(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return (
    encodeReplayTypedKey(left, "replay.key.left")
    === encodeReplayTypedKey(right, "replay.key.right")
  );
}

function applyPayload(rows: SqlRow[], payload: Payload): SqlRow[] {
  if (payload.op === "INSERT") return [...rows, { ...payload.row }];

  if (payload.op === "UPDATE") {
    const whereValue = castValue(payload.where.value);
    return rows.map((row) => {
      if (!replayKeyEqual(row[payload.where.field] as SqlPrimitive | undefined, whereValue)) return row;
      return { ...row, ...payload.set };
    });
  }

  const whereValue = castValue(payload.where.value);
  return rows.filter((row) => !replayKeyEqual(row[payload.where.field] as SqlPrimitive | undefined, whereValue));
}

export function replayPayloadsIncremental(
  initialRows: SqlRow[],
  payloads: ReplayPayload[],
  initialCommitHash = "GENESIS",
): { rows: SqlRow[]; lastCommitHash: string; invalidPayloads: number } {
  let rows = initialRows.map((r) => ({ ...r }));
  let lastCommitHash = initialCommitHash;
  let invalidPayloads = 0;

  for (const payload of payloads) {
    if (!verifyPayloadChain(payload, lastCommitHash)) {
      invalidPayloads++;
      continue;
    }

    rows = applyPayload(rows, payload);
    if (payload.currentCommitHash) lastCommitHash = payload.currentCommitHash;
  }

  return { rows, lastCommitHash, invalidPayloads };
}

async function discoverTableId(options: ReplayQueryExecutorOptions, table: string): Promise<string | undefined> {
  if (!options.autoDiscoverTables) return undefined;

  const tableCreatedType = `${options.packageId}::walrus_sql::TableCreated`;
  let cursor: Cursor = null;

  for (;;) {
    const page = await options.client.queryEvents({
      query: { MoveEventType: tableCreatedType },
      cursor,
      order: "ascending",
      limit: 50,
    });

    for (const event of page.data) {
      const tableId = String((event.parsedJson as { table_id?: string } | null)?.table_id ?? "");
      if (!tableId) continue;

      const obj = await options.client.getObject({
        id: tableId,
        options: { showContent: true, showType: true },
      });
      const content = obj.data?.content;
      if (!content || content.dataType !== "moveObject") continue;

      const nameValue = String((content.fields as Record<string, unknown>)?.name ?? "");
      if (nameValue === table) return tableId;
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }

  return undefined;
}

export function createReplayQueryExecutor(options: ReplayQueryExecutorOptions): OnchainQueryExecutor {
  const pageSize = options.pageSize ?? 50;
  const cacheFormat = options.cacheFormat ?? inferReplayCacheFormat(options.cacheFilePath);
  const cacheByTableId = new Map<string, ReplayCache>();
  const discoveredRegistry = new Map<string, string>();
  let persistedLoaded = false;

  async function loadPersistedCachesOnce(): Promise<void> {
    if (persistedLoaded) return;
    persistedLoaded = true;

    if (!options.cacheFilePath) return;

    try {
      const raw = await fs.readFile(options.cacheFilePath);
      const data = deserializeReplayCache(raw, cacheFormat);

      for (const [tableId, cache] of Object.entries(data)) {
        cacheByTableId.set(tableId, {
          cursor: cache.cursor,
          rows: cache.rows,
          seenDigests: new Set(cache.seenDigests),
          initialized: cache.initialized,
          lastCommitHash: cache.lastCommitHash ?? "GENESIS",
          invalidPayloads: cache.invalidPayloads ?? 0,
        });
      }
    } catch {
      // ignore malformed/missing cache and rebuild from chain
    }
  }

  async function persistCaches(): Promise<void> {
    if (!options.cacheFilePath) return;

    const out: PersistedReplayCache = {};

    for (const [tableId, cache] of cacheByTableId.entries()) {
      out[tableId] = {
        cursor: cache.cursor,
        rows: cache.rows,
        seenDigests: [...cache.seenDigests],
        initialized: cache.initialized,
        lastCommitHash: cache.lastCommitHash,
        invalidPayloads: cache.invalidPayloads,
      };
    }

    await fs.mkdir(dirname(options.cacheFilePath), { recursive: true });
    await fs.writeFile(options.cacheFilePath, Buffer.from(serializeReplayCache(out, cacheFormat)));
  }

  function getCache(tableId: string): ReplayCache {
    const hit = cacheByTableId.get(tableId);
    if (hit) return hit;

    const init: ReplayCache = {
      cursor: null,
      rows: [],
      seenDigests: new Set<string>(),
      initialized: false,
      lastCommitHash: "GENESIS",
      invalidPayloads: 0,
    };
    cacheByTableId.set(tableId, init);
    return init;
  }

  function resolveFromRegistry(table: string): string | undefined {
    const registry = options.tableRegistry;
    if (!registry) return undefined;
    if (registry instanceof Map) return registry.get(table);
    return registry[table];
  }

  async function resolveTableId(table: string): Promise<string | undefined> {
    const fromDiscovered = discoveredRegistry.get(table);
    if (fromDiscovered) return fromDiscovered;

    const fromRegistry = resolveFromRegistry(table);
    if (fromRegistry) return fromRegistry;

    const discovered = await discoverTableId(options, table);
    if (discovered) discoveredRegistry.set(table, discovered);
    return discovered;
  }

  async function decodePayloadFromDigest(digest: string): Promise<Payload | null> {
    const tx = await options.client.getTransactionBlock({
      digest,
      options: { showInput: true },
    });

    const programmable = tx.transaction?.data?.transaction;
    if (!programmable || programmable.kind !== "ProgrammableTransaction") return null;

    const firstTx = programmable.transactions[0] as Record<string, unknown> | undefined;
    const move =
      (firstTx?.MoveCall as { function?: string; arguments?: Array<{ Input?: number }> } | undefined) ??
      undefined;
    if (!move || !move.arguments || move.arguments.length < 3) return null;

    const fn = move.function;
    if (fn !== "insert" && fn !== "update" && fn !== "delete") return null;

    const arg2 = move.arguments[2];
    if (!arg2 || typeof arg2 !== "object" || !("Input" in arg2)) return null;

    const inputIdx = arg2.Input;
    if (typeof inputIdx !== "number") return null;

    const payloadInput = programmable.inputs[inputIdx];
    if (!payloadInput || payloadInput.type !== "pure") return null;

    return parsePayload(String(payloadInput.value));
  }

  async function replayRowsIncremental(tableId: string): Promise<SqlRow[]> {
    await loadPersistedCachesOnce();
    const cache = getCache(tableId);
    const commitEventType = `${options.packageId}::walrus_sql::CommitWritten`;

    let cursor = cache.initialized ? cache.cursor : null;
    let lastCursor = cursor;

    for (;;) {
      const page = await options.client.queryEvents({
        query: { MoveEventType: commitEventType },
        cursor,
        order: "ascending",
        limit: pageSize,
      });

      for (const event of page.data) {
        const table = (event.parsedJson as { table_id?: string } | null)?.table_id;
        if (table !== tableId) continue;

        const digest = event.id.txDigest;
        if (cache.seenDigests.has(digest)) continue;

        const payload = await decodePayloadFromDigest(digest);
        if (!payload) {
          cache.invalidPayloads += 1;
          continue;
        }

        if (!verifyPayloadChain(payload, cache.lastCommitHash)) {
          cache.invalidPayloads += 1;
          continue;
        }

        cache.rows = applyPayload(cache.rows, payload);
        cache.seenDigests.add(digest);
        if (payload.currentCommitHash) {
          cache.lastCommitHash = payload.currentCommitHash;
        }
      }

      lastCursor = page.nextCursor;
      if (!page.hasNextPage) break;
      cursor = page.nextCursor;
    }

    cache.cursor = lastCursor;
    cache.initialized = true;
    await persistCaches();
    return cache.rows;
  }

  return async (req: OnchainQueryRequest): Promise<QueryResult> => {
    if (req.explain) {
      return {
        rows: [
          {
            type: "EXPLAIN",
            table: req.table,
            where: req.where ?? null,
            groupBy: req.groupBy?.join(",") ?? null,
            aggregate: req.aggregate ?? null,
            aggregateField: req.aggregateField ?? null,
            orderBy: req.orderByList?.map((x) => `${x.field} ${x.direction}`).join(",") ?? null,
            limit: req.limit ?? null,
            offset: req.offset ?? null,
            join: req.join ? `${req.join.type} ${req.join.table} ON ${req.join.leftField}=${req.join.rightField}` : null,
            keysetHint: "Use WHERE id > '<last_id>' ORDER BY id ASC LIMIT n",
          },
        ],
      };
    }

    const leftTableId = await resolveTableId(req.table);
    if (!leftTableId) throw new Error(`Table not found: ${req.table}`);
    const leftRows = await replayRowsIncremental(leftTableId);

    let baseRows = leftRows;
    if (req.join) {
      const rightTableId = await resolveTableId(req.join.table);
      if (!rightTableId) throw new Error(`Joined table not found: ${req.join.table}`);
      const rightRows = await replayRowsIncremental(rightTableId);
      baseRows = joinRows(
        req.join.type,
        req.table,
        leftRows,
        req.join.table,
        rightRows,
        req.join.leftField,
        req.join.rightField,
      );
    }

    const clauses = req.where ? parseWhere(req.where) : [];
    const filtered = clauses.length ? applyWhereClauses(baseRows, clauses) : baseRows;

    let materialized: SqlRow[];
    if (req.groupBy?.length) {
      materialized = groupRows(filtered, req.groupBy, req.aggregate, req.aggregateField);
      if (req.having) {
        materialized = applyWhereClauses(materialized, parseWhere(req.having));
      }
    } else if (req.aggregate) {
      materialized = [computeAggregateRow(filtered, req.aggregate, req.aggregateField)];
    } else {
      materialized = filtered;
    }

    const ordered = applyOrder(
      materialized,
      req.orderByList ?? (req.orderBy ? [{ field: req.orderBy, direction: req.orderDirection ?? "ASC" }] : undefined),
    );

    const offset = req.offset ?? 0;
    const limit = req.limit ?? ordered.length;
    const paged = applyPage(ordered, offset, limit);

    return {
      rows: paged.map((row) => pickFields(row, req.fields)),
    };
  };
}
