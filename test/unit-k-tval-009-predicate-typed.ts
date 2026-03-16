import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
const internals = db as unknown as {
  compareByOp: (left: unknown, right: unknown, op: "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=") => string;
};

assert.equal(internals.compareByOp(5, 3, ">"), "TRUE");
assert.equal(internals.compareByOp(5, 5, "="), "TRUE");
assert.equal(internals.compareByOp(null, 5, ">"), "UNKNOWN");

await db.execute("CREATE TABLE users_k9 (id INT PRIMARY KEY, name TEXT, score INT)");
await db.execute("CREATE TABLE orders_k9 (id INT PRIMARY KEY, user_id INT)");

await db.execute("INSERT INTO users_k9 (id, name, score) VALUES (1, 'Alice', 8)");
await db.execute("INSERT INTO users_k9 (id, name, score) VALUES (2, 'Bob', 3)");
await db.execute("INSERT INTO users_k9 (id, name, score) VALUES (3, 'Annie', NULL)");

await db.execute("INSERT INTO orders_k9 (id, user_id) VALUES (10, 1)");
await db.execute("INSERT INTO orders_k9 (id, user_id) VALUES (11, 4)");

const between = await db.query("SELECT id FROM users_k9 WHERE score BETWEEN 5 AND 10 ORDER BY id");
assert.deepEqual(
  between.rows.map((r) => r.id),
  [1],
);

const like = await db.query("SELECT id FROM users_k9 WHERE name LIKE 'A%' ORDER BY id");
assert.deepEqual(
  like.rows.map((r) => r.id),
  [1, 3],
);

const inList = await db.query("SELECT id FROM users_k9 WHERE id IN (1, 3) ORDER BY id");
assert.deepEqual(
  inList.rows.map((r) => r.id),
  [1, 3],
);

const exists = await db.query(
  "SELECT id FROM users_k9 WHERE EXISTS (SELECT id FROM orders_k9 WHERE user_id = 1) ORDER BY id",
);
assert.deepEqual(
  exists.rows.map((r) => r.id),
  [1, 2, 3],
);

console.log("ok: K-TVAL-009 predicate execution typed comparator path");
