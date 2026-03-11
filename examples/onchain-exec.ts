import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { WalrusSqlClient, type MoveCallRequest } from "../src/index.js";

const PACKAGE_ID =
  process.env.WALRUS_SQL_PACKAGE_ID ??
  "0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95";

const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;

if (!SUI_PRIVATE_KEY) {
  throw new Error("Missing SUI_PRIVATE_KEY in environment.");
}

const { secretKey } = decodeSuiPrivateKey(SUI_PRIVATE_KEY);
const signer = Ed25519Keypair.fromSecretKey(secretKey);
const client = new SuiClient({
  url: NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"),
});

async function executeMove(req: MoveCallRequest): Promise<{ digest: string }> {
  const tx = new Transaction();
  tx.setGasBudget(100_000_000);

  // NOTE: This MVP sends pure-string args; next step will resolve object IDs (Catalog/TableMeta) automatically.
  tx.moveCall({
    target: req.target,
    arguments: req.arguments.map((a) => tx.pure.string(a)),
    typeArguments: req.typeArguments ?? [],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  return { digest: result.digest };
}

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainExecutor: executeMove,
  });

  // Planning + real send demo
  const createRes = await db.execute(`CREATE TABLE orders (id STRING PRIMARY KEY, status STRING, amount U64)`);
  console.log("CREATE tx:", createRes.txDigest, createRes.moveCall);

  // insert/update/delete require passing real TableMeta object in next phase.
  // For now we keep using plan output to verify SQL->Move mapping.
  const insertPlan = await db.execute(`INSERT INTO orders (id, status, amount) VALUES ('ord_1', 'paid', 99)`);
  console.log("INSERT plan tx:", insertPlan.txDigest, insertPlan.moveCall);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
