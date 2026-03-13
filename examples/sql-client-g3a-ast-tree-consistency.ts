import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (id INT)");
  await db.execute("INSERT INTO users (id) VALUES (1)");
  await db.execute("INSERT INTO users (id) VALUES (2)");

  const astPath = await db.query("SELECT id FROM users WHERE id > 1 ORDER BY id");
  assert.deepEqual(astPath.rows, [{ id: 2 }]);

  const treeFallbackPath = await db.query("SELECT id FROM users WHERE CAST(id AS INT) > 1 ORDER BY id");
  assert.deepEqual(treeFallbackPath.rows, [{ id: 2 }]);

  console.log("sql-client-g3a-ast-tree-consistency ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
