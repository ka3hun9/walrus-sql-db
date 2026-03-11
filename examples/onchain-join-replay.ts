import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, createReplayQueryExecutor } from "../src/index.js";

const PACKAGE_ID = process.env.WALRUS_SQL_PACKAGE_ID!;
const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? (NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"));

const LEFT_TABLE = process.env.WALRUS_SQL_LEFT_TABLE ?? "orders";
const RIGHT_TABLE = process.env.WALRUS_SQL_RIGHT_TABLE ?? "users";
const LEFT_JOIN_FIELD = process.env.WALRUS_SQL_LEFT_JOIN_FIELD ?? "user_id";
const RIGHT_JOIN_FIELD = process.env.WALRUS_SQL_RIGHT_JOIN_FIELD ?? "user_id";

const LEFT_TABLE_ID = process.env.WALRUS_SQL_LEFT_TABLE_ID;
const RIGHT_TABLE_ID = process.env.WALRUS_SQL_RIGHT_TABLE_ID;

const CACHE_FILE = process.env.WALRUS_SQL_REPLAY_CACHE_FILE ?? ".cache/replay-cache.json";

if (!PACKAGE_ID) {
  throw new Error("Missing WALRUS_SQL_PACKAGE_ID");
}

const tableRegistry: Record<string, string> = {};
if (LEFT_TABLE_ID) tableRegistry[LEFT_TABLE] = LEFT_TABLE_ID;
if (RIGHT_TABLE_ID) tableRegistry[RIGHT_TABLE] = RIGHT_TABLE_ID;

const client = new SuiClient({ url: SUI_RPC_URL });
const replay = createReplayQueryExecutor({
  client,
  packageId: PACKAGE_ID,
  tableRegistry: Object.keys(tableRegistry).length ? tableRegistry : undefined,
  autoDiscoverTables: true,
  cacheFilePath: CACHE_FILE,
});

const db = new WalrusSqlClient({
  packageId: PACKAGE_ID,
  network: `sui-${NETWORK}`,
  mode: "onchain",
  onchainQueryExecutor: replay,
});

async function main() {
  console.log(`Using RPC: ${SUI_RPC_URL}`);
  console.log(`JOIN replay: ${LEFT_TABLE} x ${RIGHT_TABLE}`);

  const explain = await db.query(
    `EXPLAIN SELECT ${LEFT_TABLE}.id, ${RIGHT_TABLE}.name, ${LEFT_TABLE}.amount FROM ${LEFT_TABLE} INNER JOIN ${RIGHT_TABLE} ON ${LEFT_TABLE}.${LEFT_JOIN_FIELD} = ${RIGHT_TABLE}.${RIGHT_JOIN_FIELD} WHERE ${LEFT_TABLE}.amount >= 0 ORDER BY ${LEFT_TABLE}.amount DESC LIMIT 20`,
  );
  console.log("EXPLAIN =>", explain.rows);

  const rows = await db.query(
    `SELECT ${LEFT_TABLE}.id, ${RIGHT_TABLE}.name, ${LEFT_TABLE}.amount FROM ${LEFT_TABLE} INNER JOIN ${RIGHT_TABLE} ON ${LEFT_TABLE}.${LEFT_JOIN_FIELD} = ${RIGHT_TABLE}.${RIGHT_JOIN_FIELD} WHERE ${LEFT_TABLE}.amount >= 0 ORDER BY ${LEFT_TABLE}.amount DESC LIMIT 20`,
  );
  console.log("JOIN rows =>", rows.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
