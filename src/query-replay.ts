import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { SuiClient } from "@mysten/sui/client";
import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { decode as decodeCbor, encode as encodeCbor } from "cbor-x";
import { inferRuntimeType, resolveCastPolicy } from "./types.js";
import type { OnchainQueryExecutor, OnchainQueryRequest, QueryResult, SqlPrimitive, SqlRow, SqlRuntimeTypeName } from "./types.js";

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

function inferReplayCacheFormat(path?: string): ReplayCacheFormat {
  if (!path) return "json";
  const p = path.toLowerCase();
  if (p.endsWith(".msgpack") || p.endsWith(".mpack") || p.endsWith(".mpk")) return "msgpack";
  if (p.endsWith(".cbor") || p.endsWith(".cb")) return "cbor";
  return "json";
}

export function serializeReplayCache(data: PersistedReplayCache, format: ReplayCacheFormat): Uint8Array {
  if (format === "msgpack") return encodeMsgpack(data);
  if (format === "cbor") return encodeCbor(data);
  return new TextEncoder().encode(JSON.stringify(data));
}

export function deserializeReplayCache(blob: Uint8Array, format: ReplayCacheFormat): PersistedReplayCache {
  if (format === "msgpack") return decodeMsgpack(blob) as PersistedReplayCache;
  if (format === "cbor") return decodeCbor(blob) as PersistedReplayCache;
  return JSON.parse(new TextDecoder().decode(blob)) as PersistedReplayCache;
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

  const coalesceMatch = expr.match(/^COALESCE\((.+)\)$/i);
  if (coalesceMatch) {
    for (const p of smartSplit(coalesceMatch[1]!)) {
      const v = evalExpr(row, p);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  const nullifMatch = expr.match(/^NULLIF\((.+),(.+)\)$/i);
  if (nullifMatch) {
    const a = evalExpr(row, nullifMatch[1]!);
    const b = evalExpr(row, nullifMatch[2]!);
    return eq(a, b) ? null : a;
  }

  let castValueExpr: string | undefined;
  let castTypeExpr: string | undefined;

  const castAsMatch = expr.match(/^CAST\((.+)\s+AS\s+(TEXT|INT|INTEGER|REAL|FLOAT|DOUBLE|BOOLEAN)\)$/i);
  if (castAsMatch) {
    castValueExpr = castAsMatch[1]!;
    castTypeExpr = castAsMatch[2]!;
  } else {
    const castFnMatch = expr.match(/^CAST\((.+)\)$/i);
    if (castFnMatch) {
      const parts = smartSplit(castFnMatch[1]!);
      if (parts.length === 2) {
        castValueExpr = parts[0]!;
        castTypeExpr = trimQuoted(parts[1]!.trim());
      }
    }
  }

  if (castValueExpr && castTypeExpr) {
    const v = evalExpr(row, castValueExpr);
    const tRaw = castTypeExpr.toUpperCase();
    const t = tRaw === "INTEGER" ? "INT" : tRaw === "REAL" ? "DOUBLE" : tRaw;
    if (v == null) return null;
    const sourceType = inferRuntimeType(v);
    if (resolveCastPolicy(sourceType, t as SqlRuntimeTypeName, "explicit") === "reject") {
      throw new Error(`ERR_TYPE_CONSTRAINT: CAST ${sourceType} -> ${t} not allowed`);
    }
    if (t === "TEXT") return String(v);
    if (t === "INT") {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`ERR_TYPE_CONSTRAINT: invalid CAST to INT: ${String(v)}`);
      return Math.trunc(n);
    }
    if (t === "FLOAT" || t === "DOUBLE") {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`ERR_TYPE_CONSTRAINT: invalid CAST to ${t}: ${String(v)}`);
      return n;
    }
    if (t === "BOOLEAN") {
      const b = String(v).trim().toLowerCase();
      if (b === "true" || b === "1") return true;
      if (b === "false" || b === "0") return false;
      throw new Error(`ERR_TYPE_CONSTRAINT: invalid CAST to BOOLEAN: ${String(v)}`);
    }
    throw new Error(`ERR_TYPE_CONSTRAINT: unsupported CAST target: ${t}`);
  }

  if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(expr)) return row[expr] as SqlPrimitive | undefined;

  const lit = castValue(expr);
  if (expr.startsWith("'") || expr.startsWith('"') || typeof lit !== "string") return lit;

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
    if ("()+-*/%".includes(ch)) {
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
  const pri: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3 };

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
    if (["+", "-", "*", "/", "%"].includes(t)) {
      const prev = tokens[i - 1];
      const unary = t === "-" && (i === 0 || prev === "(" || ["+", "-", "*", "/", "%"].includes(prev!));
      const op = unary ? "u-" : t;
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

function eq(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): boolean {
  if (a == null && b == null) return true;
  return String(a) === String(b);
}

function compare(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

function compareByOp(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined, op: ComparePredicate): TruthValue {
  if (left == null || right == null) return "UNKNOWN";

  switch (op) {
    case "=":
      return eq(left, right) ? "TRUE" : "FALSE";
    case "!=":
    case "<>":
      return eq(left, right) ? "FALSE" : "TRUE";
    case ">":
      return compare(left, right) > 0 ? "TRUE" : "FALSE";
    case "<":
      return compare(left, right) < 0 ? "TRUE" : "FALSE";
    case ">=":
      return compare(left, right) >= 0 ? "TRUE" : "FALSE";
    case "<=":
      return compare(left, right) <= 0 ? "TRUE" : "FALSE";
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
      const regex = likeToRegex(String(right ?? ""), clause.likeEscape);
      const matched = new RegExp(regex, "i").test(String(left ?? ""));
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

  const base = compare(a, b);
  return direction === "DESC" ? -base : base;
}

function applyPage(rows: SqlRow[], offset?: number, limit?: number): SqlRow[] {
  const from = offset ?? 0;
  const size = limit ?? rows.length;
  return rows.slice(from, from + size);
}

function computeAggregateRow(
  rows: SqlRow[],
  aggregate: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX",
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

  const nums = rows
    .map((r) => r[aggregateField])
    .filter((v) => v !== null && v !== undefined)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (aggregate === "SUM") return { sum: nums.length ? nums.reduce((a, b) => a + b, 0) : null };
  if (aggregate === "AVG") return { avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null };
  if (aggregate === "MIN") return { min: nums.length ? Math.min(...nums) : null };
  return { max: nums.length ? Math.max(...nums) : null };
}

function groupRows(
  rows: SqlRow[],
  groupBy: string[],
  aggregate?: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX",
  aggregateField?: string,
): SqlRow[] {
  const buckets = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const key = groupBy.map((g) => String(row[g])).join("||");
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
  joinType: "INNER" | "LEFT" | "RIGHT",
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
  for (const l of leftRows) {
    let matched = false;
    for (const r of rightRows) {
      if (String(l[leftField]) !== String(r[rightField])) continue;
      matched = true;
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

    if (!matched && joinType === "LEFT") {
      const merged: SqlRow = {};
      for (const [k, v] of Object.entries(l)) {
        merged[k] = v;
        merged[`${leftTable}.${k}`] = v;
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

function applyPayload(rows: SqlRow[], payload: Payload): SqlRow[] {
  if (payload.op === "INSERT") return [...rows, payload.row];

  if (payload.op === "UPDATE") {
    return rows.map((row) => {
      if (String(row[payload.where.field]) !== payload.where.value) return row;
      return { ...row, ...payload.set };
    });
  }

  return rows.filter((row) => String(row[payload.where.field]) !== payload.where.value);
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
