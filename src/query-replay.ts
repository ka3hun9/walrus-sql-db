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
  tableRegistry?: Map<string, string> | Record<string, string>;
  ownerAddress?: string;
  autoDiscoverTables?: boolean;
  pageSize?: number;
}

function trimQuoted(raw: string): string {
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseWhere(whereExpr: string): Array<{ field: string; value: string }> {
  const parts = whereExpr.split(/\s+AND\s+/i).map((x) => x.trim());
  return parts.map((part) => {
    const m = part.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
    if (!m) throw new Error(`Unsupported WHERE expression: ${whereExpr}`);
    return { field: m[1].trim(), value: trimQuoted(m[2].trim()) };
  });
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

async function discoverTableId(options: ReplayQueryExecutorOptions, table: string): Promise<string | undefined> {
  if (!options.autoDiscoverTables || !options.ownerAddress) return undefined;

  const scan = await options.client.getOwnedObjects({
    owner: options.ownerAddress,
    filter: { StructType: `${options.packageId}::walrus_sql::TableMeta` },
    options: { showContent: true, showType: true },
    limit: 100,
  });

  for (const item of scan.data) {
    const id = item.data?.objectId;
    const content = item.data?.content;
    if (!id || !content || content.dataType !== "moveObject") continue;
    const nameValue = String((content.fields as Record<string, unknown>)?.name ?? "");
    if (nameValue === table) return id;
  }

  return undefined;
}

export function createReplayQueryExecutor(options: ReplayQueryExecutorOptions): OnchainQueryExecutor {
  const pageSize = options.pageSize ?? 50;
  const cacheByTableId = new Map<string, ReplayCache>();
  const discoveredRegistry = new Map<string, string>();

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
    const tableId = await resolveTableId(req.table);
    if (!tableId) throw new Error(`Table not found: ${req.table}`);

    const replayed = await replayRowsIncremental(tableId);

    const clauses = req.where ? parseWhere(req.where) : [];
    const filtered = clauses.length
      ? replayed.filter((row) => clauses.every((c) => String(row[c.field]) === c.value))
      : replayed;

    if (req.aggregate === "COUNT") {
      return { rows: [{ count: filtered.length }] };
    }

    const ordered = req.orderBy
      ? [...filtered].sort((a, b) => {
          const av = a[req.orderBy!];
          const bv = b[req.orderBy!];
          const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
          return req.orderDirection === "DESC" ? -cmp : cmp;
        })
      : filtered;

    const offset = req.offset ?? 0;
    const limit = req.limit ?? ordered.length;
    const paged = ordered.slice(offset, offset + limit);

    return {
      rows: paged.map((row) => pickFields(row, req.fields)),
    };
  };
}
