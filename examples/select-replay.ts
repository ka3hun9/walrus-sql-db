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

if (!TABLE_ID) throw new Error("Missing WALRUS_SQL_TABLE_ID in .env");

const client = new SuiClient({ url: SUI_RPC_URL });
const replayQuery = createReplayQueryExecutor({
  client,
  packageId: PACKAGE_ID,
  tableRegistry: {
    [TABLE_NAME]: TABLE_ID,
  },
  pageSize: 50,
});

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainQueryExecutor: replayQuery,
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
