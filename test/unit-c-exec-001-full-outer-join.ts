import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users_foj (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders_foj (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_foj (id, name) VALUES (1, 'Alice')");
await db.execute("INSERT INTO users_foj (id, name) VALUES (2, 'Bob')");
await db.execute("INSERT INTO orders_foj (id, user_id, amount) VALUES (10, 1, 100)");
await db.execute("INSERT INTO orders_foj (id, user_id, amount) VALUES (11, 3, 200)");

const rows = await db.query(
  "SELECT users_foj.id, users_foj.name, orders_foj.user_id, orders_foj.amount FROM users_foj FULL OUTER JOIN orders_foj ON users_foj.id = orders_foj.user_id ORDER BY users_foj.id ASC, orders_foj.user_id ASC",
);

assert.equal(rows.rows.length, 3);
assert.deepEqual(rows.rows[0], { "users_foj.id": 1, "users_foj.name": "Alice", "orders_foj.user_id": 1, "orders_foj.amount": 100 });
assert.deepEqual(rows.rows[1], { "users_foj.id": 2, "users_foj.name": "Bob", "orders_foj.user_id": null, "orders_foj.amount": null });
assert.deepEqual(rows.rows[2], { "users_foj.id": null, "users_foj.name": null, "orders_foj.user_id": 3, "orders_foj.amount": 200 });

console.log("ok: C-EXEC-001 FULL OUTER JOIN semantics with NULL padding");
