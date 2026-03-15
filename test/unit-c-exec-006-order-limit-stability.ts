import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users_ols (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders_ols (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_ols (id, name) VALUES (1, 'A')");
await db.execute("INSERT INTO users_ols (id, name) VALUES (2, 'B')");
await db.execute("INSERT INTO users_ols (id, name) VALUES (3, 'C')");
await db.execute("INSERT INTO users_ols (id, name) VALUES (4, 'D')");

await db.execute("INSERT INTO orders_ols (id, user_id, amount) VALUES (10, 1, 100)");
await db.execute("INSERT INTO orders_ols (id, user_id, amount) VALUES (11, 2, 100)");
await db.execute("INSERT INTO orders_ols (id, user_id, amount) VALUES (12, 3, 90)");
await db.execute("INSERT INTO orders_ols (id, user_id, amount) VALUES (13, 1, 80)");

const page = await db.query(
  "SELECT users_ols.id, orders_ols.amount FROM users_ols INNER JOIN orders_ols ON users_ols.id = orders_ols.user_id WHERE orders_ols.amount >= 80 ORDER BY orders_ols.amount DESC, users_ols.id ASC LIMIT 2 OFFSET 1",
);
assert.deepEqual(
  page.rows.map((r) => [r["users_ols.id"], r["orders_ols.amount"]]),
  [
    [2, 100],
    [3, 90],
  ],
);

const groupedPage = await db.query(
  "SELECT users_ols.id, COUNT(orders_ols.id) FROM users_ols LEFT JOIN orders_ols ON users_ols.id = orders_ols.user_id GROUP BY users_ols.id ORDER BY count DESC, users_ols.id ASC LIMIT 3",
);
assert.deepEqual(
  groupedPage.rows.map((r) => [r["users_ols.id"], r.count]),
  [
    [1, 2],
    [2, 1],
    [3, 1],
  ],
);

console.log("ok: C-EXEC-006 ORDER BY + LIMIT/OFFSET stable behavior in complex queries");
