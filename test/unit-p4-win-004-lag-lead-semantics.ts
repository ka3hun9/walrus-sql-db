import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { WalrusSqlClient } from "../src/client.js";
import { parseSqlToAst } from "../src/sql-parser.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_win004_sales (id INT PRIMARY KEY, region TEXT, month TEXT, amount INT)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (1, 'East', '2024-01', 100)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (2, 'East', '2024-02', 150)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (3, 'East', '2024-03', 200)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (4, 'East', '2024-04', 180)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (5, 'West', '2024-01', 80)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (6, 'West', '2024-02', 120)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (7, 'West', '2024-03', 160)");
await db.execute("INSERT INTO p4_win004_sales (id, region, month, amount) VALUES (8, 'West', '2024-04', NULL)");

// LAG with default
const lagWithDefault = await db.query(
  "SELECT region, month, amount, LAG(amount, 0) OVER (PARTITION BY region ORDER BY month) AS prev_amount FROM p4_win004_sales ORDER BY region, month",
);
assert.deepEqual(
  lagWithDefault.rows.map((row) => [row.region, row.month, row.amount, row.prev_amount]),
  [
    ["East", "2024-01", 100, 0],
    ["East", "2024-02", 150, 100],
    ["East", "2024-03", 200, 150],
    ["East", "2024-04", 180, 200],
    ["West", "2024-01", 80, 0],
    ["West", "2024-02", 120, 80],
    ["West", "2024-03", 160, 120],
    ["West", "2024-04", null, 160],
  ],
);

// LEAD with default
const leadWithDefault = await db.query(
  "SELECT region, month, amount, LEAD(amount, 0) OVER (PARTITION BY region ORDER BY month) AS next_amount FROM p4_win004_sales ORDER BY region, month",
);
assert.deepEqual(
  leadWithDefault.rows.map((row) => [row.region, row.month, row.amount, row.next_amount]),
  [
    ["East", "2024-01", 100, 150],
    ["East", "2024-02", 150, 200],
    ["East", "2024-03", 200, 180],
    ["East", "2024-04", 180, 0],
    ["West", "2024-01", 80, 120],
    ["West", "2024-02", 120, 160],
    ["West", "2024-03", 160, null],
    ["West", "2024-04", null, 0],
  ],
);

// LAG with NULL default (default offset=1)
const lagNullDefault = await db.query(
  "SELECT region, month, amount, LAG(amount) OVER (PARTITION BY region ORDER BY month) AS prev_amount FROM p4_win004_sales ORDER BY region, month",
);
assert.deepEqual(
  lagNullDefault.rows.map((row) => [row.region, row.month, row.amount, row.prev_amount]),
  [
    ["East", "2024-01", 100, null],
    ["East", "2024-02", 150, 100],
    ["East", "2024-03", 200, 150],
    ["East", "2024-04", 180, 200],
    ["West", "2024-01", 80, null],
    ["West", "2024-02", 120, 80],
    ["West", "2024-03", 160, 120],
    ["West", "2024-04", null, 160],
  ],
);

// LAG with custom offset=2
const lagOffset2 = await db.query(
  "SELECT region, month, amount, LAG(amount, -999, 2) OVER (PARTITION BY region ORDER BY month) AS prev2_amount FROM p4_win004_sales WHERE region = 'East' ORDER BY month",
);
assert.deepEqual(
  lagOffset2.rows.map((row) => [row.month, row.amount, row.prev2_amount]),
  [
    ["2024-01", 100, -999],
    ["2024-02", 150, -999],
    ["2024-03", 200, 100],
    ["2024-04", 180, 150],
  ],
);

// LEAD with custom offset=2
const leadOffset2 = await db.query(
  "SELECT region, month, amount, LEAD(amount, -999, 2) OVER (PARTITION BY region ORDER BY month) AS next2_amount FROM p4_win004_sales WHERE region = 'East' ORDER BY month",
);
assert.deepEqual(
  leadOffset2.rows.map((row) => [row.month, row.amount, row.next2_amount]),
  [
    ["2024-01", 100, 200],
    ["2024-02", 150, 180],
    ["2024-03", 200, -999],
    ["2024-04", 180, -999],
  ],
);

// LAG/LEAD combined with ROW_NUMBER
const combined = await db.query(
  "SELECT region, month, amount, ROW_NUMBER() OVER (PARTITION BY region ORDER BY month) AS rn, LAG(amount) OVER (PARTITION BY region ORDER BY month) AS prev, LEAD(amount) OVER (PARTITION BY region ORDER BY month) AS next FROM p4_win004_sales WHERE region = 'East' ORDER BY month",
);
assert.deepEqual(
  combined.rows.map((row) => [row.month, row.rn, row.amount, row.prev, row.next]),
  [
    ["2024-01", 1, 100, null, 150],
    ["2024-02", 2, 150, 100, 200],
    ["2024-03", 3, 200, 150, 180],
    ["2024-04", 4, 180, 200, null],
  ],
);

// Parser test
const ast = parseSqlToAst(
  "SELECT LAG(amount, -1, 0) OVER (PARTITION BY region ORDER BY month) AS prev_amount FROM p4_win004_sales",
);
assert.equal(ast.kind, "select");
if (ast.kind === "select") {
  const lagItem = ast.selectItems[0];
  assert.ok(lagItem?.window, "LAG window function must exist");
  assert.equal(lagItem?.window?.name, "LAG");
  assert.equal(lagItem?.window?.args.length, 3);
}

// Checklist check
const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-WIN-004\b/.test(checklist), false, "P4-WIN-004 must be checked");

console.log("ok: P4-WIN-004 LAG/LEAD offset and default value semantics");
