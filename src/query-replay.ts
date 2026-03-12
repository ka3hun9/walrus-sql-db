import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { SuiClient } from "@mysten/sui/client";
import type { OnchainQueryExecutor, OnchainQueryRequest, QueryResult, SqlPrimitive, SqlRow } from "./types.js";

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

type WhereClause = {
  logic?: LogicOp;
  field: string;
  op: CompareOp;
  value?: SqlPrimitive;
  values?: SqlPrimitive[];
};

type ReplayCache = {
  cursor: Cursor;
  rows: SqlRow[];
  seenDigests: Set<string>;
  initialized: boolean;
  lastCommitHash: string;
  invalidPayloads: number;
};

export interface ReplayQueryExecutorOptions {
  client: SuiClient;
  packageId: string;
  tableRegistry?: Map<string, string> | Record<string, string>;
  ownerAddress?: string;
  autoDiscoverTables?: boolean;
  pageSize?: number;
  cacheFilePath?: string;
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

function parseAtomicWhereClause(token: string): WhereClause {
  const expr = token.trim().replace(/^\((.*)\)$/s, "$1").trim();

  const nullMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+IS\s+(NOT\s+)?NULL$/i);
  if (nullMatch) {
    return {
      field: nullMatch[1],
      op: nullMatch[2] ? "IS_NOT_NULL" : "IS_NULL",
    };
  }

  const betweenMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
  if (betweenMatch) {
    return {
      field: betweenMatch[1],
      op: betweenMatch[2] ? "NOT_BETWEEN" : "BETWEEN",
      values: [castValue(betweenMatch[3]), castValue(betweenMatch[4])],
    };
  }

  const likeMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?LIKE\s+(.+)$/i);
  if (likeMatch) {
    return {
      field: likeMatch[1],
      op: likeMatch[2] ? "NOT_LIKE" : "LIKE",
      value: castValue(likeMatch[3]),
    };
  }

  const inMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
  if (inMatch) {
    return {
      field: inMatch[1],
      op: inMatch[2] ? "NOT_IN" : "IN",
      values: smartSplit(inMatch[3]).map((v) => castValue(v)),
    };
  }

  const cmpMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i);
  if (cmpMatch) {
    return {
      field: cmpMatch[1],
      op: cmpMatch[2] as CompareOp,
      value: castValue(cmpMatch[3]),
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
  const left = row[clause.field];

  if (clause.op === "IN" || clause.op === "NOT_IN") {
    const values = clause.values ?? [];
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
    const lower = clause.values?.[0];
    const upper = clause.values?.[1];
    const inRange = tvAnd(compareByOp(left, lower, ">="), compareByOp(left, upper, "<="));
    return clause.op === "BETWEEN" ? inRange : tvNot(inRange);
  }

  const right = clause.value;
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
      const pattern = String(right ?? "")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      const matched = new RegExp(`^${pattern}$`, "i").test(String(left ?? ""));
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
      const cmp = compare(a[field], b[field]);
      if (cmp !== 0) return direction === "DESC" ? -cmp : cmp;
    }
    return 0;
  });
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
    return { count: rows.length };
  }

  if (!aggregateField || aggregateField === "*") {
    throw new Error(`${aggregate} requires a numeric field`);
  }

  const nums = rows.map((r) => Number(r[aggregateField])).filter((n) => Number.isFinite(n));
  if (aggregate === "SUM") return { sum: nums.reduce((a, b) => a + b, 0) };
  if (aggregate === "AVG") return { avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
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
  const cacheByTableId = new Map<string, ReplayCache>();
  const discoveredRegistry = new Map<string, string>();
  let persistedLoaded = false;

  async function loadPersistedCachesOnce(): Promise<void> {
    if (persistedLoaded) return;
    persistedLoaded = true;

    if (!options.cacheFilePath) return;

    try {
      const raw = await fs.readFile(options.cacheFilePath, "utf8");
      const data = JSON.parse(raw) as Record<
        string,
        {
          cursor: Cursor;
          rows: SqlRow[];
          seenDigests: string[];
          initialized: boolean;
          lastCommitHash: string;
          invalidPayloads: number;
        }
      >;

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

    const out: Record<
      string,
      {
        cursor: Cursor;
        rows: SqlRow[];
        seenDigests: string[];
        initialized: boolean;
        lastCommitHash: string;
        invalidPayloads: number;
      }
    > = {};

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
    await fs.writeFile(options.cacheFilePath, JSON.stringify(out, null, 2), "utf8");
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
