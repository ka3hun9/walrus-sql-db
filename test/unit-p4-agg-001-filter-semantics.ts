import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { WalrusSqlClient } from "../src/client.js";
import { parseSqlToAst } from "../src/sql-parser.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_agg001_t (id INT PRIMARY KEY, grp TEXT, status TEXT, val INT)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (1, 'X', 'active', 100)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (2, 'X', 'active', 200)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (3, 'X', 'inactive', 300)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (4, 'X', 'active', 400)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (5, 'Y', 'active', 50)");
await db.execute("INSERT INTO p4_agg001_t (id, grp, status, val) VALUES (6, 'Y', 'inactive', 150)");

// Note: aliases on aggregate functions are not supported in this implementation yet,
// so we use the canonical field names (count, sum, avg, min, max) for non-grouped aggregates.

// COUNT(*) FILTER (WHERE ...)
const cntActive = await db.query(
  "SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_cnt FROM p4_agg001_t",
);
// Since aliases aren't resolved for aggregate-only queries, check the actual result:
// Filter: active rows = (1,'X','active',100), (2,'X','active',200), (4,'X','active',400), (5,'Y','active',50)
// COUNT = 4
assert.deepEqual(cntActive.rows.map((r) => Object.values(r)), [[4]]);

// COUNT(*) with no matching rows FILTER
const cntNever = await db.query(
  "SELECT COUNT(*) FILTER (WHERE status = 'deleted') FROM p4_agg001_t",
);
assert.deepEqual(cntNever.rows.map((r) => Object.values(r)), [[0]]);

// COUNT(field) FILTER - only counts non-null values matching filter
const cntActiveField = await db.query(
  "SELECT COUNT(val) FILTER (WHERE status = 'active') FROM p4_agg001_t",
);
// Active rows have val: 100, 200, 400, 50 (all non-null, 4 values)
assert.deepEqual(cntActiveField.rows.map((r) => Object.values(r)), [[4]]);

// SUM(val) FILTER (WHERE ...)
const sumActive = await db.query(
  "SELECT SUM(val) FILTER (WHERE status = 'active') FROM p4_agg001_t",
);
// Active val: 100+200+400+50 = 750
assert.deepEqual(sumActive.rows.map((r) => Object.values(r)), [[750]]);

// AVG(val) FILTER (WHERE ...)
const avgActive = await db.query(
  "SELECT AVG(val) FILTER (WHERE status = 'active') FROM p4_agg001_t",
);
// AVG of 100, 200, 400, 50 = 750/4 = 187.5
const avgVal = avgActive.rows[0]!.avg as number;
assert.ok(Math.abs(avgVal - 187.5) < 0.01, `Expected 187.5, got ${avgVal}`);

// MIN/MAX with FILTER
const minActive = await db.query(
  "SELECT MIN(val) FILTER (WHERE status = 'active') FROM p4_agg001_t",
);
assert.deepEqual(minActive.rows.map((r) => Object.values(r)), [[50]]);

const maxActive = await db.query(
  "SELECT MAX(val) FILTER (WHERE status = 'active') FROM p4_agg001_t",
);
assert.deepEqual(maxActive.rows.map((r) => Object.values(r)), [[400]]);

// FILTER with GROUP BY - filter applies within each group
const groupFilter = await db.query(
  "SELECT grp, COUNT(*) FILTER (WHERE status = 'active') FROM p4_agg001_t GROUP BY grp ORDER BY grp",
);
assert.deepEqual(
  groupFilter.rows.map((r) => [r.grp, r.count]),
  [
    ["X", 3], // rows 1,2,4 are active in group X (3 rows)
    ["Y", 1], // row 5 is active in group Y
  ],
);

// FILTER with inequality condition
const gtFilter = await db.query(
  "SELECT SUM(val) FILTER (WHERE val > 100) FROM p4_agg001_t",
);
// val > 100: rows 2(200), 3(300), 4(400), 6(150) = 200+300+400+150 = 1050
assert.deepEqual(gtFilter.rows.map((r) => Object.values(r)), [[1050]]);

// COUNT with combined FILTER (no group by, single-row result)
const combinedFilter = await db.query(
  "SELECT COUNT(*) FILTER (WHERE grp = 'X' AND val >= 200) FROM p4_agg001_t",
);
// grp='X' AND val>=200: rows 2(200), 3(300), 4(400) = 3 rows
assert.deepEqual(combinedFilter.rows.map((r) => Object.values(r)), [[3]]);

// Parser test - verify FILTER AST is parsed correctly
const ast = parseSqlToAst(
  "SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_cnt FROM p4_agg001_t",
);
assert.equal(ast.kind, "select");
if (ast.kind === "select") {
  const countItem = ast.selectItems[0];
  assert.ok(countItem?.expr, "expression must exist");
  assert.equal(countItem!.expr.kind, "function");
  if (countItem!.expr.kind === "function") {
    assert.equal(countItem!.expr.name, "COUNT");
    assert.ok(countItem!.expr.filter, "filter must be parsed");
    assert.equal(countItem!.expr.filter!.kind, "binary");
  }
}

// Checklist check
const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-AGG-001\b/.test(checklist), false, "P4-AGG-001 must be checked");

console.log("ok: P4-AGG-001 aggregate FILTER (WHERE ...) clause semantics");
