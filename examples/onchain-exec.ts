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

const tableByName = new Map<string, string>();

async function executeMove(req: MoveCallRequest): Promise<{ digest: string; createdTableId?: string; raw?: unknown }> {
  const tx = new Transaction();
  tx.setGasBudget(100_000_000);

  if (req.statementType === "CREATE") {
    tx.moveCall({
      target: req.target,
      arguments: [tx.pure.string(req.arguments[0]), tx.pure.string(req.arguments[1])],
      typeArguments: req.typeArguments ?? [],
    });
  } else {
    const tableName = req.tableName;
    if (!tableName) {
      throw new Error(`Missing tableName for ${req.statementType}`);
    }
    const tableId = tableByName.get(tableName);
    if (!tableId) {
      throw new Error(`Missing table object for '${tableName}'. Run CREATE TABLE in this session first.`);
    }

    tx.moveCall({
      target: req.target,
      arguments: [
        tx.object(tableId),
        tx.pure.string(req.arguments[0]),
        tx.pure.string(req.arguments[1]),
        tx.pure.string(req.arguments[2]),
      ],
      typeArguments: req.typeArguments ?? [],
    });
  }

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  });

  const status = result.effects?.status?.status;
  if (status !== "success") {
    throw new Error(`tx failed(${req.statementType}): ${JSON.stringify(result.effects?.status)}`);
  }

  let createdTableId: string | undefined;
  if (req.statementType === "CREATE") {
    const createdTable = result.objectChanges?.find(
      (c) => c.type === "created" && c.objectType.endsWith("::walrus_sql::TableMeta"),
    );
    if (createdTable && createdTable.type === "created") {
      createdTableId = createdTable.objectId;
      if (req.tableName) tableByName.set(req.tableName, createdTableId);
    } else {
      throw new Error("CREATE succeeded but no TableMeta object found in changes.");
    }
  }

  return {
    digest: result.digest,
    createdTableId,
    raw: result,
  };
}

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainExecutor: executeMove,
  });

  const tableName = `orders_${Date.now()}`;

  const createRes = await db.execute(
    `CREATE TABLE ${tableName} (id STRING PRIMARY KEY, status STRING, amount U64)`,
  );
  console.log("CREATE tx:", createRes.txDigest, "tableId:", createRes.tableObjectId);

  const insertRes = await db.execute(
    `INSERT INTO ${tableName} (id, status, amount) VALUES ('ord_1', 'paid', 99)`,
  );
  console.log("INSERT tx:", insertRes.txDigest);

  const updateRes = await db.execute(`UPDATE ${tableName} SET status = 'shipped' WHERE id = 'ord_1'`);
  console.log("UPDATE tx:", updateRes.txDigest);

  const deleteRes = await db.execute(`DELETE FROM ${tableName} WHERE id = 'ord_1'`);
  console.log("DELETE tx:", deleteRes.txDigest);

  console.log("CRUD on-chain smoke test completed ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
