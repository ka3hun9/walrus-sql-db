import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_pred (id INT PRIMARY KEY, v INT, name TEXT)");
await db.execute("INSERT INTO t_pred (id, v, name) VALUES (1, 1, 'A_1')");
await db.execute("INSERT INTO t_pred (id, v, name) VALUES (2, 3, 'A11')");
await db.execute("INSERT INTO t_pred (id, v, name) VALUES (3, 5, 'B_1')");
await db.execute("INSERT INTO t_pred (id, v, name) VALUES (4, NULL, NULL)");

const between = await db.query("SELECT id FROM t_pred WHERE v BETWEEN 2 AND 5 ORDER BY id");
assert.deepEqual(between.rows.map((r) => r.id), [2, 3]);

const notBetween = await db.query("SELECT id FROM t_pred WHERE v NOT BETWEEN 2 AND 5 ORDER BY id");
assert.deepEqual(notBetween.rows.map((r) => r.id), [1]);

const like = await db.query("SELECT id FROM t_pred WHERE name LIKE 'A!_%' ESCAPE '!' ORDER BY id");
assert.deepEqual(like.rows.map((r) => r.id), [1]);

const notLike = await db.query("SELECT id FROM t_pred WHERE name NOT LIKE 'A!_%' ESCAPE '!' ORDER BY id");
assert.deepEqual(notLike.rows.map((r) => r.id), [2, 3]);

const inList = await db.query("SELECT id FROM t_pred WHERE v IN (1, 5) ORDER BY id");
assert.deepEqual(inList.rows.map((r) => r.id), [1, 3]);

const notInList = await db.query("SELECT id FROM t_pred WHERE v NOT IN (1, 5) ORDER BY id");
assert.deepEqual(notInList.rows.map((r) => r.id), [2]);

await db.execute("CREATE TABLE users_pred (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE orders_pred (id INT PRIMARY KEY, user_id INT)");
await db.execute("INSERT INTO users_pred (id) VALUES (1)");
await db.execute("INSERT INTO users_pred (id) VALUES (2)");
await db.execute("INSERT INTO users_pred (id) VALUES (3)");
await db.execute("INSERT INTO orders_pred (id, user_id) VALUES (10, 1)");
await db.execute("INSERT INTO orders_pred (id, user_id) VALUES (11, 3)");

const inSubquery = await db.query(
  "SELECT id FROM users_pred WHERE id IN (SELECT user_id FROM orders_pred) ORDER BY id",
);
assert.deepEqual(inSubquery.rows.map((r) => r.id), [1, 3]);

const existsCorrelated = await db.query(
  "SELECT id FROM users_pred WHERE EXISTS (SELECT 1 FROM orders_pred WHERE orders_pred.user_id = outer.id) ORDER BY id",
);
assert.deepEqual(existsCorrelated.rows.map((r) => r.id), [1, 3]);

const notExistsCorrelated = await db.query(
  "SELECT id FROM users_pred WHERE NOT EXISTS (SELECT 1 FROM orders_pred WHERE orders_pred.user_id = outer.id) ORDER BY id",
);
assert.deepEqual(notExistsCorrelated.rows.map((r) => r.id), [2]);

console.log("ok: C-EXEC-002 predicate execution semantics (BETWEEN/LIKE/IN/EXISTS)");
