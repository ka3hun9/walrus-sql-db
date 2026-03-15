import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_dml2 (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE orders_dml2 (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_dml2 (id, tier) VALUES (1, 0)");
await db.execute("INSERT INTO users_dml2 (id, tier) VALUES (2, 0)");
await db.execute("INSERT INTO users_dml2 (id, tier) VALUES (3, 0)");

await db.execute("INSERT INTO orders_dml2 (id, user_id, amount) VALUES (10, 1, 80)");
await db.execute("INSERT INTO orders_dml2 (id, user_id, amount) VALUES (11, 2, 40)");
await db.execute("INSERT INTO orders_dml2 (id, user_id, amount) VALUES (12, 3, 200)");

await db.execute("UPDATE users_dml2 SET tier = 1 WHERE id = (SELECT MIN(user_id) FROM orders_dml2)");
await db.execute("UPDATE users_dml2 SET tier = 2 WHERE id IN (SELECT user_id FROM orders_dml2 WHERE amount >= 100)");
await db.execute(
  "UPDATE users_dml2 SET tier = 3 WHERE EXISTS (SELECT 1 FROM orders_dml2 WHERE orders_dml2.user_id = outer.id AND amount > 150)",
);

const q = await db.query("SELECT id, tier FROM users_dml2 ORDER BY id");
assert.deepEqual(
  q.rows.map((r) => [r.id, r.tier]),
  [
    [1, 1],
    [2, 0],
    [3, 3],
  ],
);

console.log("ok: D-DML-002 UPDATE subquery predicates (scalar/IN/EXISTS)");
