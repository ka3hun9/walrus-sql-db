import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_j2 (id INT PRIMARY KEY, name TEXT, tier INT)");
await db.execute("CREATE TABLE orders_j2 (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_j2 (id, name, tier) VALUES (1, 'Alice', 0)");
await db.execute("INSERT INTO users_j2 (id, name, tier) VALUES (2, 'Bob', 0)");
await db.execute("INSERT INTO users_j2 (id, name, tier) VALUES (3, 'Ann', 0)");
await db.execute("INSERT INTO users_j2 (id, name, tier) VALUES (4, 'Dana', 0)");

await db.execute("INSERT INTO orders_j2 (id, user_id, amount) VALUES (10, 1, 120)");
await db.execute("INSERT INTO orders_j2 (id, user_id, amount) VALUES (11, 2, 40)");
await db.execute("INSERT INTO orders_j2 (id, user_id, amount) VALUES (12, 3, 150)");
await db.execute("INSERT INTO orders_j2 (id, user_id, amount) VALUES (13, 4, 20)");

await db.execute(
  "UPDATE users_j2 SET tier = 5 WHERE id IN (SELECT user_id FROM orders_j2 WHERE amount >= 100) AND (name LIKE 'A%' OR id BETWEEN 2 AND 3)",
);

await db.execute(
  "DELETE FROM users_j2 WHERE EXISTS (SELECT 1 FROM orders_j2 WHERE orders_j2.user_id = outer.id AND amount < 50) OR id = (SELECT MIN(user_id) FROM orders_j2 WHERE amount >= 100)",
);

const q = await db.query("SELECT id, tier FROM users_j2 ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.tier]),
  [[3, 5]],
);

console.log("ok: J-MILE-002 UPDATE/DELETE acceptance with subquery + complex predicates");
