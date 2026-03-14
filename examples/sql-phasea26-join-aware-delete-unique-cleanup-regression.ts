import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, email TEXT UNIQUE, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, email, tier) VALUES (1, 'a@example.com', 1)");
  await db.execute("INSERT INTO users (id, email, tier) VALUES (2, 'b@example.com', 2)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 2, 200)");

  // join-aware DELETE removes user#1
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 100");

  let users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, email: "b@example.com", tier: 2 }]);

  // unique-index cleanup on join-aware DELETE must allow key reuse
  await db.execute("INSERT INTO users (id, email, tier) VALUES (3, 'a@example.com', 3)");

  users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 2, email: "b@example.com", tier: 2 },
    { id: 3, email: "a@example.com", tier: 3 },
  ]);

  console.log("sql-phasea26-join-aware-delete-unique-cleanup-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
