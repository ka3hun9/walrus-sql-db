import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_dml (id INT PRIMARY KEY, name TEXT, age INT, code TEXT, tier INT)");
await db.execute("CREATE TABLE orders_dml (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_dml (id, name, age, code, tier) VALUES (1, 'Alice', 25, 'A_1', 0)");
await db.execute("INSERT INTO users_dml (id, name, age, code, tier) VALUES (2, 'Bob', 35, 'A11', 0)");
await db.execute("INSERT INTO users_dml (id, name, age, code, tier) VALUES (3, 'Cid', 28, 'B_1', 0)");
await db.execute("INSERT INTO users_dml (id, name, age, code, tier) VALUES (4, 'Dan', 40, NULL, 0)");

await db.execute("INSERT INTO orders_dml (id, user_id, amount) VALUES (10, 1, 120)");
await db.execute("INSERT INTO orders_dml (id, user_id, amount) VALUES (11, 3, 80)");
await db.execute("INSERT INTO orders_dml (id, user_id, amount) VALUES (12, 4, 150)");

await db.execute("UPDATE users_dml SET tier = 1 WHERE age BETWEEN 20 AND 30");
await db.execute("UPDATE users_dml SET tier = 2 WHERE code LIKE 'A!_%' ESCAPE '!'");
await db.execute("UPDATE users_dml SET tier = 3 WHERE id IN (2, 4)");
await db.execute(
  "UPDATE users_dml SET tier = 5 WHERE EXISTS (SELECT 1 FROM orders_dml WHERE orders_dml.user_id = outer.id AND amount > 100)",
);

const q = await db.query("SELECT id, tier FROM users_dml ORDER BY id");
assert.deepEqual(
  q.rows.map((r) => [r.id, r.tier]),
  [
    [1, 5],
    [2, 3],
    [3, 1],
    [4, 5],
  ],
);

console.log("ok: D-DML-001 UPDATE complex WHERE predicates");
