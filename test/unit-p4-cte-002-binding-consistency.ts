import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, cust TEXT, amt INT)");
await db.execute("INSERT INTO orders (id, cust, amt) VALUES (1, 'A', 100)");
await db.execute("INSERT INTO orders (id, cust, amt) VALUES (2, 'A', 200)");
await db.execute("INSERT INTO orders (id, cust, amt) VALUES (3, 'B', 50)");
await db.execute("INSERT INTO orders (id, cust, amt) VALUES (4, 'B', 300)");
await db.execute("INSERT INTO orders (id, cust, amt) VALUES (5, 'C', 150)");

// Create a persistent view for later
await db.execute("CREATE VIEW cust_totals AS SELECT cust, SUM(amt) FROM orders GROUP BY cust");

// 1. CTE + ORDER BY + LIMIT on main query
const r1 = await db.query(`
  WITH big_orders AS (SELECT id, cust, amt FROM orders WHERE amt >= 100)
  SELECT id, cust, amt FROM big_orders ORDER BY amt DESC LIMIT 3
`);
assert.equal(r1.rows.length, 3, `Expected 3 rows`);
assert.equal(r1.rows[0]!["amt"], 300, `First amt should be 300`);
console.log("ok: CTE + ORDER BY + LIMIT binding");

// 2. CTE used inside a subquery (FROM subquery)
const r2 = await db.query(`
  WITH top AS (SELECT cust, amt FROM orders WHERE amt > 100)
  SELECT cust FROM (SELECT cust, amt FROM top WHERE amt < 250) AS sub ORDER BY cust
`);
// big orders > 100: (2,'A',200),(4,'B',300),(5,'C',150)
// sub (amt < 250): (2,'A',200),(5,'C',150)
assert.equal(r2.rows.length, 2, `Expected 2 from subquery`);
assert.deepEqual(r2.rows.map((r) => r["cust"]), ["A", "C"]);
console.log("ok: CTE in subquery FROM");

// 3. CTE scope: does not bleed out after query
const noBleed = await db.query(`
  WITH temp_scope AS (SELECT id FROM orders WHERE id = 1)
  SELECT id FROM temp_scope
`);
assert.equal(noBleed.rows.length, 1);
// The 'temp_scope' table should not exist after query
let scopeError: Error | null = null;
try {
  await db.query("SELECT * FROM temp_scope");
} catch (e) {
  scopeError = e as Error;
}
assert.ok(scopeError !== null, "temp_scope should not be accessible outside CTE query");
console.log("ok: CTE scope cleanup — no bleed");

// 4. CTE alongside a persistent view
const r4 = await db.query(`
  WITH top_cust AS (SELECT cust FROM orders WHERE amt >= 150)
  SELECT cust FROM cust_totals WHERE cust IN (SELECT cust FROM top_cust) ORDER BY cust
`);
// cust_totals has all 3 customers; top_cust has A (200), B (300), C (150)
assert.ok(r4.rows.length >= 1, `Should have results`);
console.log("ok: CTE alongside persistent view");

// 5. Multiple CTEs where second references first
// (second CTE selects from first CTE's result)
const r5 = await db.query(`
  WITH
    large AS (SELECT cust, amt FROM orders WHERE amt >= 200),
    top_large AS (SELECT cust FROM large WHERE amt >= 300)
  SELECT cust FROM top_large
`);
// large: A(200), B(300); top_large: B(300)
assert.equal(r5.rows.length, 1, `Expected 1 row from nested CTE`);
assert.equal(r5.rows[0]!["cust"], "B");
console.log("ok: sequential CTEs (second references first)");

console.log("\nok: P4-CTE-002 CTE binding consistency with subquery/view");
