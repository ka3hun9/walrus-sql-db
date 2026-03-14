import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, org_id INT, code INT, tier INT, UNIQUE(org_id, code))");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, org_id, code, tier) VALUES (1, 10, 100, 1)");
  await db.execute("INSERT INTO users (id, org_id, code, tier) VALUES (2, 10, 200, 2)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");

  // join-aware DELETE removes user#1, releasing composite unique key (10,100)
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 100");

  let users = await db.query("SELECT id, org_id, code, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, org_id: 10, code: 200, tier: 2 }]);

  // composite key should be reusable after join-aware delete
  await db.execute("INSERT INTO users (id, org_id, code, tier) VALUES (3, 10, 100, 3)");

  users = await db.query("SELECT id, org_id, code, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 2, org_id: 10, code: 200, tier: 2 },
    { id: 3, org_id: 10, code: 100, tier: 3 },
  ]);

  console.log("sql-phasea28-join-aware-delete-composite-unique-cleanup-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
