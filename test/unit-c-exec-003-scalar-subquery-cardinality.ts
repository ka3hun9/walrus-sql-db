import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users_sq (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE orders_sq (id INT PRIMARY KEY, user_id INT, amount INT)");
await db.execute("INSERT INTO users_sq (id) VALUES (1)");
await db.execute("INSERT INTO users_sq (id) VALUES (2)");
await db.execute("INSERT INTO users_sq (id) VALUES (3)");
await db.execute("INSERT INTO orders_sq (id, user_id, amount) VALUES (10, 2, 100)");
await db.execute("INSERT INTO orders_sq (id, user_id, amount) VALUES (11, 3, 200)");

const validScalar = await db.query(
  "SELECT id FROM users_sq WHERE id = (SELECT MIN(user_id) FROM orders_sq) ORDER BY id",
);
assert.deepEqual(validScalar.rows.map((r) => r.id), [2]);

await assert.rejects(
  db.query("SELECT id FROM users_sq WHERE id = (SELECT user_id FROM orders_sq) ORDER BY id"),
  /ERR_UNSUPPORTED_SUBQUERY: Scalar subquery must return exactly 1 row/,
);

await assert.rejects(
  db.query("SELECT id FROM users_sq WHERE id = (SELECT user_id, amount FROM orders_sq WHERE id = 10) ORDER BY id"),
  /ERR_UNSUPPORTED_SUBQUERY: Scalar subquery must return exactly 1 column/,
);

const emptyScalar = await db.query(
  "SELECT id FROM users_sq WHERE id = (SELECT user_id FROM orders_sq WHERE id = 999) ORDER BY id",
);
assert.equal(emptyScalar.rows.length, 0);

console.log("ok: C-EXEC-003 scalar subquery cardinality and error handling");
