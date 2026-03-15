import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_j1 (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders_j1 (id INT PRIMARY KEY, user_id INT, amount INT, status TEXT)");
await db.execute("CREATE TABLE refunds_j1 (id INT PRIMARY KEY, order_id INT, amount INT)");

await db.execute("INSERT INTO users_j1 (id, name) VALUES (1, 'Alice')");
await db.execute("INSERT INTO users_j1 (id, name) VALUES (2, 'Bob')");
await db.execute("INSERT INTO users_j1 (id, name) VALUES (3, 'Cara')");

await db.execute("INSERT INTO orders_j1 (id, user_id, amount, status) VALUES (10, 1, 30, 'paid')");
await db.execute("INSERT INTO orders_j1 (id, user_id, amount, status) VALUES (11, 1, 20, 'shipped')");
await db.execute("INSERT INTO orders_j1 (id, user_id, amount, status) VALUES (12, 2, 50, 'paid')");
await db.execute("INSERT INTO orders_j1 (id, user_id, amount, status) VALUES (13, 3, 10, 'draft')");

await db.execute("INSERT INTO refunds_j1 (id, order_id, amount) VALUES (100, 11, 5)");
await db.execute("INSERT INTO refunds_j1 (id, order_id, amount) VALUES (101, 12, 10)");

const q = await db.query(
  "SELECT user_id, SUM(amount) FROM users_j1 INNER JOIN orders_j1 ON users_j1.id = orders_j1.user_id LEFT JOIN refunds_j1 ON orders_j1.id = refunds_j1.order_id WHERE status IN ('paid','shipped') GROUP BY user_id ORDER BY sum DESC, user_id ASC LIMIT 1 OFFSET 1",
);

assert.deepEqual(
  q.rows.map((row) => [row.user_id, row.sum]),
  [[2, 50]],
);

console.log("ok: J-MILE-001 complex join/group/order-pagination acceptance");
