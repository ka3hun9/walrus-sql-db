import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, tier INT, amount INT)");

  await db.execute("INSERT INTO users (id, tier) VALUES (1, 1)");
  await db.execute("INSERT INTO users (id, tier) VALUES (2, 2)");

  await db.execute("INSERT INTO orders (id, user_id, tier, amount) VALUES (10, 1, 100, 50)");
  await db.execute("INSERT INTO orders (id, user_id, tier, amount) VALUES (11, 2, 200, 200)");

  // unqualified overlapping WHERE token resolves to left row field deterministically
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 9 WHERE tier = 2");
  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 9 },
  ]);

  // qualified right-side filter still works and can target specific join partner state
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 8 WHERE o.tier = 200");
  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 8 },
  ]);

  // same deterministic rule for delete: unqualified tier is from left row
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE tier = 1");
  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, tier: 8 }]);

  console.log("sql-phasea18-join-aware-ambiguous-where-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
