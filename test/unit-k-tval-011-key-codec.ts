import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
const internals = db as unknown as {
  encodeTypedKey: (value: unknown, sourceContext: string) => string;
  joinKeyEqual: (left: unknown, right: unknown) => boolean;
};

assert.notEqual(internals.encodeTypedKey(1, "k"), internals.encodeTypedKey("1", "k"));
assert.equal(internals.joinKeyEqual(1, "1"), false);
assert.equal(internals.joinKeyEqual(1, 1), true);

await db.execute("CREATE TABLE users_k11 (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders_k11 (id INT PRIMARY KEY, user_id TEXT)");
await db.execute("INSERT INTO users_k11 (id, name) VALUES (1, 'Alice')");
await db.execute("INSERT INTO orders_k11 (id, user_id) VALUES (10, '1')");

const join = await db.query(
  "SELECT users_k11.id AS uid FROM users_k11 INNER JOIN orders_k11 ON users_k11.id = orders_k11.user_id ORDER BY uid",
);
assert.equal(join.rows.length, 0);

await db.execute("CREATE TABLE group_k11 (id INT PRIMARY KEY, v TEXT)");
await db.execute("INSERT INTO group_k11 (id, v) VALUES (1, '1')");
await db.execute("INSERT INTO group_k11 (id, v) VALUES (2, '1')");
await db.execute("INSERT INTO group_k11 (id, v) VALUES (3, '2')");

const grouped = await db.query("SELECT v, COUNT(*) FROM group_k11 GROUP BY v ORDER BY v ASC");
assert.deepEqual(grouped.rows, [{ v: "1", count: 2 }, { v: "2", count: 1 }]);

console.log("ok: K-TVAL-011 typed key codec for join/group/order/distinct");
