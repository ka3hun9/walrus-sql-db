import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE emp (id INT PRIMARY KEY, dept TEXT, sal INT)");
await db.execute("INSERT INTO emp (id, dept, sal) VALUES (1, 'Eng', 100)");
await db.execute("INSERT INTO emp (id, dept, sal) VALUES (2, 'Eng', 200)");
await db.execute("INSERT INTO emp (id, dept, sal) VALUES (3, 'Sales', 150)");
await db.execute("INSERT INTO emp (id, dept, sal) VALUES (4, 'Sales', 300)");
await db.execute("INSERT INTO emp (id, dept, sal) VALUES (5, 'HR', 50)");

// 1. Basic CTE
const r1 = await db.query(`
  WITH eng AS (SELECT id, sal FROM emp WHERE dept = 'Eng')
  SELECT id, sal FROM eng ORDER BY sal ASC
`);
assert.equal(r1.rows.length, 2, `Expected 2 eng rows, got ${r1.rows.length}`);
assert.deepEqual(r1.rows.map((r) => r["sal"]), [100, 200], `Wrong sal order`);
console.log("ok: basic CTE");

// 2. CTE with aggregation
const r2 = await db.query(`
  WITH dept_sum AS (SELECT dept, SUM(sal) FROM emp GROUP BY dept)
  SELECT dept FROM dept_sum ORDER BY dept ASC
`);
assert.equal(r2.rows.length, 3, `Expected 3 depts, got ${r2.rows.length}`);
assert.deepEqual(r2.rows.map((r) => r["dept"]), ["Eng", "HR", "Sales"]);
console.log("ok: CTE with aggregation");

// 3. Multiple CTEs
const r3 = await db.query(`
  WITH
    high AS (SELECT id, sal FROM emp WHERE sal >= 200),
    low AS (SELECT id, sal FROM emp WHERE sal < 100)
  SELECT id, sal FROM high ORDER BY sal ASC
`);
assert.equal(r3.rows.length, 2, `Expected 2 high rows, got ${r3.rows.length}`);
assert.deepEqual(r3.rows.map((r) => r["id"]), [2, 4]);
console.log("ok: multiple CTEs");

// 4. CTE referenced in WHERE subquery context
const r4 = await db.query(`
  WITH top_sal AS (SELECT sal FROM emp WHERE dept = 'Sales')
  SELECT id, sal FROM emp WHERE sal IN (SELECT sal FROM top_sal) ORDER BY id
`);
assert.ok(r4.rows.length >= 1, "Expected at least one match");
console.log("ok: CTE in subquery context");

// 5. CTE with alias shadowing (CTE name doesn't conflict with table names)
const r5 = await db.query(`
  WITH hr_emp AS (SELECT id FROM emp WHERE dept = 'HR')
  SELECT COUNT(*) FROM hr_emp
`);
const cnt = Object.values(r5.rows[0]!)[0] as number;
assert.equal(cnt, 1, `Expected 1 HR row, got ${cnt}`);
console.log("ok: CTE count");

console.log("\nok: P4-CTE-001 WITH basic capability");
