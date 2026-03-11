import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, createReplayQueryExecutor } from "../src/index.js";

const PACKAGE_ID =
  process.env.WALRUS_SQL_PACKAGE_ID ??
  "0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95";
const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? (NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"));

const TABLE_NAME = process.env.WALRUS_SQL_TABLE_NAME ?? "orders";
const TABLE_ID = process.env.WALRUS_SQL_TABLE_ID;
const OWNER_ADDRESS = process.env.SUI_OWNER_ADDRESS;
const CACHE_FILE = process.env.WALRUS_SQL_REPLAY_CACHE_FILE ?? ".cache/replay-cache.json";

const client = new SuiClient({ url: SUI_RPC_URL });

const tableRegistry = TABLE_ID
  ? {
      [TABLE_NAME]: TABLE_ID,
    }
  : undefined;

const replayQuery = createReplayQueryExecutor({
  client,
  packageId: PACKAGE_ID,
  tableRegistry,
  ownerAddress: OWNER_ADDRESS,
  autoDiscoverTables: true,
  pageSize: 50,
  cacheFilePath: CACHE_FILE,
});

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  const dt = Date.now() - t0;
  console.log(`${label} took ${dt}ms`);
  return result;
}

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainQueryExecutor: replayQuery,
  });

  console.log(`Using RPC: ${SUI_RPC_URL}`);
  console.log(`Replay table: ${TABLE_NAME} -> ${TABLE_ID ?? "<auto-discover>"}`);
  console.log(`Replay cache file: ${CACHE_FILE}`);

  const all = await timed("SELECT * (cold/warm)", () =>
    db.query(`SELECT * FROM ${TABLE_NAME} ORDER BY id ASC LIMIT 20 OFFSET 0`),
  );
  console.log("SELECT * (replay) =>", all.rows);

  const one = await timed("SELECT filtered", () =>
    db.query(
      `SELECT id, status, amount FROM ${TABLE_NAME} WHERE id = 'ord_1' AND status = 'shipped' ORDER BY id DESC LIMIT 10 OFFSET 0`,
    ),
  );
  console.log("SELECT filtered (replay) =>", one.rows);

  const count = await timed("SELECT COUNT(*)", () =>
    db.query(`SELECT COUNT(*) FROM ${TABLE_NAME} WHERE status = 'shipped'`),
  );
  console.log("SELECT COUNT(*) =>", count.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
