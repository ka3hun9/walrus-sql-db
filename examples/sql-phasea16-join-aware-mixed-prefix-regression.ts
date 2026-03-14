import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, tier) VALUES (1, 1)");
  await db.execute("INSERT INTO users (id, tier) VALUES (2, 2)");
  await db.execute("INSERT INTO users (id, tier) VALUES (3, 3)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 2, 200)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 3, 50)");

  // mixed ON prefix + WHERE table-qualified names should work even with aliases
  await db.execute(
    "UPDATE users u JOIN orders o ON users.id = o.user_id SET u.tier = 9 WHERE orders.amount = 200 AND users.id = 2",
  );

  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 9 },
    { id: 3, tier: 3 },
  ]);

  // mixed ON prefix + WHERE alias-qualified names should work when ON uses table prefix on right
  await db.execute(
    "UPDATE users u JOIN orders o ON u.id = orders.user_id SET tier = 8 WHERE o.amount = 200 AND u.id = 2",
  );

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 8 },
    { id: 3, tier: 3 },
  ]);

  // delete should also honor table-qualified filters when aliases are present
  await db.execute(
    "DELETE u FROM users u JOIN orders o ON users.id = o.user_id WHERE orders.amount = 200 AND users.id = 2",
  );

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 3, tier: 3 },
  ]);

  console.log("sql-phasea16-join-aware-mixed-prefix-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
