import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_del2 (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE orders_del2 (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_del2 (id) VALUES (1)");
await db.execute("INSERT INTO users_del2 (id) VALUES (2)");
await db.execute("INSERT INTO users_del2 (id) VALUES (3)");
await db.execute("INSERT INTO users_del2 (id) VALUES (4)");

await db.execute("INSERT INTO orders_del2 (id, user_id, amount) VALUES (10, 1, 50)");
await db.execute("INSERT INTO orders_del2 (id, user_id, amount) VALUES (11, 3, 200)");
await db.execute("INSERT INTO orders_del2 (id, user_id, amount) VALUES (12, 4, 10)");

await db.execute("DELETE FROM users_del2 WHERE id = (SELECT MIN(user_id) FROM orders_del2)");
await db.execute("DELETE FROM users_del2 WHERE id IN (SELECT user_id FROM orders_del2 WHERE amount >= 100)");
await db.execute(
  "DELETE FROM users_del2 WHERE EXISTS (SELECT 1 FROM orders_del2 WHERE orders_del2.user_id = outer.id AND amount < 20)",
);

const q = await db.query("SELECT id FROM users_del2 ORDER BY id");
assert.deepEqual(q.rows.map((r) => r.id), [2]);

console.log("ok: D-DML-005 DELETE subquery predicates (scalar/IN/EXISTS)");
