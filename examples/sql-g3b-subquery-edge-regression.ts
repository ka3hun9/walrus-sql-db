import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (user_id TEXT, name TEXT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, status TEXT)");

  await db.execute("INSERT INTO users (user_id, name) VALUES ('u1', 'Alice')");
  await db.execute("INSERT INTO users (user_id, name) VALUES ('u2', 'Bob')");
  await db.execute("INSERT INTO users (user_id, name) VALUES ('u3', 'Carol')");

  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o1', 'u1', 10, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o2', 'u2', 20, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o3', null, 30, 'pending')");

  // 1) Correlated EXISTS should keep users with matching orders.
  const existsRows = await db.query(
    "SELECT user_id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = outer.user_id) ORDER BY user_id",
  );
  assert.deepEqual(existsRows.rows, [{ user_id: "u1" }, { user_id: "u2" }]);

  // 2) NOT IN subquery + NULL in subquery result => UNKNOWN => filtered out all rows.
  const notInRows = await db.query(
    "SELECT user_id FROM users WHERE user_id NOT IN (SELECT user_id FROM orders) ORDER BY user_id",
  );
  assert.deepEqual(notInRows.rows, []);

  // 3) Scalar subquery compare against NULL aggregate should return no rows.
  const scalarNullRows = await db.query(
    "SELECT id FROM orders WHERE amount > (SELECT MIN(amount) FROM orders WHERE status = 'missing') ORDER BY id",
  );
  assert.deepEqual(scalarNullRows.rows, []);

  console.log("sql-g3b-subquery-edge-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
