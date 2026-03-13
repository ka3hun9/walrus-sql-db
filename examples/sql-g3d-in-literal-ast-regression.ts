import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE o (id TEXT, user_id TEXT, amount INT)");
  await db.execute("INSERT INTO o (id, user_id, amount) VALUES ('o1', 'u1', 10)");
  await db.execute("INSERT INTO o (id, user_id, amount) VALUES ('o2', 'u2', 20)");
  await db.execute("INSERT INTO o (id, user_id, amount) VALUES ('o3', 'u4', 30)");

  const inList = await db.query("SELECT id FROM o WHERE user_id IN ('u1','u4') ORDER BY id");
  assert.deepEqual(inList.rows, [{ id: "o1" }, { id: "o3" }]);

  const notInList = await db.query("SELECT id FROM o WHERE user_id NOT IN ('u2') ORDER BY id");
  assert.deepEqual(notInList.rows, [{ id: "o1" }, { id: "o3" }]);

  console.log("sql-g3d-in-literal-ast-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
