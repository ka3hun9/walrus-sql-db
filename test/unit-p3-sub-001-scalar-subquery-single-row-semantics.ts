import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_sub1_users (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE p3_sub1_orders (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO p3_sub1_users (id, tier) VALUES (1, 0)");
await db.execute("INSERT INTO p3_sub1_users (id, tier) VALUES (2, 0)");
await db.execute("INSERT INTO p3_sub1_users (id, tier) VALUES (3, 0)");

await db.execute("INSERT INTO p3_sub1_orders (id, user_id, amount) VALUES (10, 1, 30)");
await db.execute("INSERT INTO p3_sub1_orders (id, user_id, amount) VALUES (11, 2, 60)");
await db.execute("INSERT INTO p3_sub1_orders (id, user_id, amount) VALUES (12, 3, 90)");

const scalarOneRow = await db.query(
  "SELECT id FROM p3_sub1_users WHERE id = (SELECT MIN(user_id) FROM p3_sub1_orders) ORDER BY id",
);
assert.deepEqual(scalarOneRow.rows.map((r) => r.id), [1]);

const scalarExprLeft = await db.query(
  "SELECT id FROM p3_sub1_users WHERE id * 30 = (SELECT amount FROM p3_sub1_orders WHERE user_id = 2)",
);
assert.deepEqual(scalarExprLeft.rows.map((r) => r.id), [2]);

const scalarZeroRows = await db.query(
  "SELECT id FROM p3_sub1_users WHERE id = (SELECT user_id FROM p3_sub1_orders WHERE id = 999)",
);
assert.equal(scalarZeroRows.rows.length, 0);

await assert.rejects(
  db.query("SELECT id FROM p3_sub1_users WHERE id = (SELECT user_id FROM p3_sub1_orders WHERE amount >= 60)"),
  /ERR_UNSUPPORTED_SUBQUERY: Scalar subquery must return exactly 1 row/,
);

await assert.rejects(
  db.query("SELECT id FROM p3_sub1_users WHERE id = (SELECT user_id, amount FROM p3_sub1_orders WHERE id = 10)"),
  /ERR_UNSUPPORTED_SUBQUERY: Scalar subquery must return exactly 1 column/,
);

await db.execute(
  "UPDATE p3_sub1_users SET tier = 9 WHERE id * 30 = (SELECT amount FROM p3_sub1_orders WHERE user_id = 2)",
);
const updatedTier = await db.query("SELECT tier FROM p3_sub1_users WHERE id = 2");
assert.equal(updatedTier.rows[0]?.tier, 9);

console.log("ok: P3-SUB-001 scalar subquery execution and single-row error semantics");
