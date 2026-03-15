import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users_upj (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE orders_upj (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_upj (id, tier) VALUES (1, 0)");
await db.execute("INSERT INTO users_upj (id, tier) VALUES (2, 0)");
await db.execute("INSERT INTO users_upj (id, tier) VALUES (3, 0)");

await db.execute("INSERT INTO orders_upj (id, user_id, amount) VALUES (10, 1, 100)");
await db.execute("INSERT INTO orders_upj (id, user_id, amount) VALUES (11, 2, 50)");
await db.execute("INSERT INTO orders_upj (id, user_id, amount) VALUES (12, 4, 70)");

await db.execute(
  "UPDATE users_upj u INNER JOIN orders_upj o ON u.id = o.user_id SET u.tier = 1 WHERE o.amount >= 60",
);
await db.execute(
  "UPDATE users_upj u LEFT JOIN orders_upj o ON u.id = o.user_id SET u.tier = 2 WHERE o.user_id IS NULL",
);
await db.execute(
  "UPDATE users_upj u RIGHT JOIN orders_upj o ON u.id = o.user_id SET u.tier = 3 WHERE o.amount >= 60",
);
await db.execute(
  "UPDATE users_upj u FULL OUTER JOIN orders_upj o ON u.id = o.user_id SET u.tier = 4 WHERE o.user_id IS NULL",
);

const q = await db.query("SELECT id, tier FROM users_upj ORDER BY id");
assert.deepEqual(
  q.rows.map((r) => [r.id, r.tier]),
  [
    [1, 3],
    [2, 0],
    [3, 4],
  ],
);

console.log("ok: D-DML-003 UPDATE JOIN variants (INNER/LEFT/RIGHT/FULL OUTER)");
