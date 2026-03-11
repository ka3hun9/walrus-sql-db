import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, createReplayQueryExecutor } from "../src/index.js";

const PACKAGE_ID = process.env.WALRUS_SQL_PACKAGE_ID!;
const TABLE_NAME = process.env.WALRUS_SQL_TABLE_NAME!;
const OWNER_ADDRESS = process.env.SUI_OWNER_ADDRESS;
const TABLE_ID = process.env.WALRUS_SQL_TABLE_ID;
const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? (NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"));
const CACHE_FILE = process.env.WALRUS_SQL_REPLAY_CACHE_FILE ?? ".cache/replay-cache.json";

if (!PACKAGE_ID || !TABLE_NAME) {
  throw new Error("Missing WALRUS_SQL_PACKAGE_ID or WALRUS_SQL_TABLE_NAME");
}

const client = new SuiClient({ url: SUI_RPC_URL });
const replayQuery = createReplayQueryExecutor({
  client,
  packageId: PACKAGE_ID,
  tableRegistry: TABLE_ID ? { [TABLE_NAME]: TABLE_ID } : undefined,
  ownerAddress: OWNER_ADDRESS,
  autoDiscoverTables: true,
  cacheFilePath: CACHE_FILE,
});

const db = new WalrusSqlClient({
  packageId: PACKAGE_ID,
  network: `sui-${NETWORK}`,
  mode: "onchain",
  onchainQueryExecutor: replayQuery,
});

async function runOnce(label: string) {
  const t0 = Date.now();
  await db.query(`SELECT * FROM ${TABLE_NAME} ORDER BY id ASC LIMIT 100 OFFSET 0`);
  const dt = Date.now() - t0;
  console.log(`${label}: ${dt}ms`);
  return dt;
}

async function main() {
  const cold = await runOnce("cold");
  const warm = await runOnce("warm");
  console.log(`improvement: ${(cold - warm).toFixed(0)}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
