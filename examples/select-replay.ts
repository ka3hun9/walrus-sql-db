import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, type OnchainQueryRequest, type QueryResult, type SqlRow } from "../src/index.js";

const PACKAGE_ID =
  process.env.WALRUS_SQL_PACKAGE_ID ??
  "0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95";
const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? (NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"));

const TABLE_NAME = process.env.WALRUS_SQL_TABLE_NAME ?? "orders";
const TABLE_ID = process.env.WALRUS_SQL_TABLE_ID;

if (!TABLE_ID) throw new Error("Missing WALRUS_SQL_TABLE_ID in .env");

const client = new SuiClient({ url: SUI_RPC_URL });
const tableRegistry = new Map<string, string>([[TABLE_NAME, TABLE_ID]]);

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

const replayCacheByTable = new Map<string, ReplayCache>();

function getCache(tableId: string): ReplayCache {
  const hit = replayCacheByTable.get(tableId);
  if (hit) return hit;

  const init: ReplayCache = {
    cursor: null,
    rows: [],
    seenDigests: new Set<string>(),
    initialized: false,
  };
  replayCacheByTable.set(tableId, init);
  return init;
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

async function decodePayloadFromDigest(digest: string): Promise<Payload | null> {
  const tx = await client.getTransactionBlock({
    digest,
    options: { showInput: true },
  });

  const programmable = tx.transaction?.data?.transaction;
  if (!programmable || programmable.kind !== "ProgrammableTransaction") return null;

  const firstTx = programmable.transactions[0] as Record<string, unknown> | undefined;
  const move = (firstTx?.MoveCall as { function?: string; arguments?: Array<{ Input?: number }> } | undefined) ?? undefined;
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
  const commitEventType = `${PACKAGE_ID}::walrus_sql::CommitWritten`;

  let cursor = cache.initialized ? cache.cursor : null;
  let lastCursor = cursor;

  for (;;) {
    const page = await client.queryEvents({
      query: { MoveEventType: commitEventType },
      cursor,
      order: "ascending",
      limit: 50,
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

async function onchainQueryExecutor(req: OnchainQueryRequest): Promise<QueryResult> {
  const tableId = tableRegistry.get(req.table);
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
}

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainQueryExecutor,
  });

  console.log(`Using RPC: ${SUI_RPC_URL}`);
  console.log(`Replay table: ${TABLE_NAME} -> ${TABLE_ID}`);

  const all = await db.query(`SELECT * FROM ${TABLE_NAME} LIMIT 20 OFFSET 0`);
  console.log("SELECT * (replay) =>", all.rows);

  const one = await db.query(`SELECT id, status, amount FROM ${TABLE_NAME} WHERE id = 'ord_1' LIMIT 10 OFFSET 0`);
  console.log("SELECT filtered (replay) =>", one.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
