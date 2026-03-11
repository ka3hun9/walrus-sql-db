import { SuiClient } from "@mysten/sui/client";
import type { OnchainQueryExecutor, OnchainQueryRequest, QueryResult, SqlRow } from "./types.js";

type Payload =
  | { v: number; op: "INSERT"; table: string; row: SqlRow }
  | {
      v: number;
      op: "UPDATE";
      table: string;
      set: Record<string, string | number | boolean | null>;
      where: { field: string; value: string };
    }
  | { v: number; op: "DELETE"; table: string; where: { field: string; value: string } };

type Cursor = { txDigest: string; eventSeq: string } | null | undefined;

type ReplayCache = {
  cursor: Cursor;
  rows: SqlRow[];
  seenDigests: Set<string>;
  initialized: boolean;
};

export interface ReplayQueryExecutorOptions {
  client: SuiClient;
  packageId: string;
  tableRegistry: Map<string, string> | Record<string, string>;
  pageSize?: number;
}

function parseWhere(whereExpr: string): { field: string; value: string } {
  const m = whereExpr.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
  if (!m) throw new Error(`Unsupported WHERE expression: ${whereExpr}`);
  const raw = m[2].trim();
  const value =
    (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
      ? raw.slice(1, -1)
      : raw;
  return { field: m[1].trim(), value };
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

function resolveTableId(registry: Map<string, string> | Record<string, string>, table: string): string | undefined {
  if (registry instanceof Map) return registry.get(table);
  return registry[table];
}

export function createReplayQueryExecutor(options: ReplayQueryExecutorOptions): OnchainQueryExecutor {
  const pageSize = options.pageSize ?? 50;
  const cacheByTableId = new Map<string, ReplayCache>();

  function getCache(tableId: string): ReplayCache {
    const hit = cacheByTableId.get(tableId);
    if (hit) return hit;

    const init: ReplayCache = {
      cursor: null,
      rows: [],
      seenDigests: new Set<string>(),
      initialized: false,
    };
    cacheByTableId.set(tableId, init);
    return init;
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
        if (!payload) continue;

        cache.rows = applyPayload(cache.rows, payload);
        cache.seenDigests.add(digest);
      }

      lastCursor = page.nextCursor;
      if (!page.hasNextPage) break;
      cursor = page.nextCursor;
    }

    cache.cursor = lastCursor;
    cache.initialized = true;
    return cache.rows;
  }

  return async (req: OnchainQueryRequest): Promise<QueryResult> => {
    const tableId = resolveTableId(options.tableRegistry, req.table);
    if (!tableId) throw new Error(`Table not found: ${req.table}`);

    const replayed = await replayRowsIncremental(tableId);
    const where = req.where ? parseWhere(req.where) : undefined;
    const filtered = where ? replayed.filter((row) => String(row[where.field]) === where.value) : replayed;

    const offset = req.offset ?? 0;
    const limit = req.limit ?? filtered.length;
    const paged = filtered.slice(offset, offset + limit);

    return {
      rows: paged.map((row) => pickFields(row, req.fields)),
    };
  };
}
