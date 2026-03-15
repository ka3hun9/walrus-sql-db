import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE sales_gha (id INT PRIMARY KEY, region TEXT, product TEXT, amount INT)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (1, 'APAC', 'A', 10)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (2, 'APAC', 'A', 20)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (3, 'APAC', 'B', 5)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (4, 'EU', 'A', 7)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (5, 'EU', 'A', 18)");
await db.execute("INSERT INTO sales_gha (id, region, product, amount) VALUES (6, 'EU', 'B', NULL)");

const grouped = await db.query(
  "SELECT region, product, SUM(amount) FROM sales_gha GROUP BY region, product HAVING sum > 15 ORDER BY region, product",
);
assert.deepEqual(
  grouped.rows.map((r) => [r.region, r.product, r.sum]),
  [
    ["APAC", "A", 30],
    ["EU", "A", 25],
  ],
);

const groupedCount = await db.query(
  "SELECT region, COUNT(id) FROM sales_gha GROUP BY region HAVING count >= 3 ORDER BY region",
);
assert.equal(groupedCount.rows.length, 2);
assert.equal(groupedCount.rows[0]!.region, "APAC");
assert.equal(groupedCount.rows[0]!.count, 3);
assert.equal(groupedCount.rows[1]!.region, "EU");
assert.equal(groupedCount.rows[1]!.count, 3);

const groupedAvg = await db.query(
  "SELECT region, AVG(amount) FROM sales_gha GROUP BY region HAVING avg > 10 ORDER BY region",
);
assert.equal(groupedAvg.rows.length, 2);
assert.equal(groupedAvg.rows[0]!.region, "APAC");
assert.equal(groupedAvg.rows[0]!.avg, 35 / 3);
assert.equal(groupedAvg.rows[1]!.region, "EU");
assert.equal(groupedAvg.rows[1]!.avg, 12.5);

console.log("ok: C-EXEC-005 GROUP BY + HAVING + aggregate combined execution");
