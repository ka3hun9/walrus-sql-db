import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { WalrusSqlClient } from "../src/client.js";
import { parseSqlToAst } from "../src/sql-parser.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_win005_scores (id INT PRIMARY KEY, grp TEXT, score INT)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (1, 'A', 100)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (2, 'A', 200)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (3, 'A', 300)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (4, 'A', 400)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (5, 'B', 50)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (6, 'B', 150)");
await db.execute("INSERT INTO p4_win005_scores (id, grp, score) VALUES (7, 'B', 250)");

// ROW_NUMBER with ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW (default)
const unboundedFrame = await db.query(
  "SELECT id, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rn FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  unboundedFrame.rows.map((row) => [row.id, row.rn]),
  [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ],
);

// ROW_NUMBER with ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
// For row 4, frame = rows at positions 1,2,3 (3 rows in frame, ROW_NUMBER = 3)
const twoPrecedingFrame = await db.query(
  "SELECT id, score, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rn FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  twoPrecedingFrame.rows.map((row) => [row.id, row.score, row.rn]),
  [
    [1, 100, 1],
    [2, 200, 2],
    [3, 300, 3],
    [4, 400, 3],
  ],
);

// ROW_NUMBER with ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
// Each row's frame starts at itself and goes to end of partition
// ROW_NUMBER within frame = 1 for all rows (frame always starts at current row)
const currentToUnbounded = await db.query(
  "SELECT id, score, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS rn FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  currentToUnbounded.rows.map((row) => [row.id, row.score, row.rn]),
  [
    [1, 100, 1],
    [2, 200, 1],
    [3, 300, 1],
    [4, 400, 1],
  ],
);

// ROW_NUMBER with ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
// Row 1: frame = rows 1-2 (1 row, ROW_NUMBER=1)
// Row 2: frame = rows 1-3 (2 rows, ROW_NUMBER=2)
// Row 3: frame = rows 2-4 (2 rows, ROW_NUMBER=2)
// Row 4: frame = rows 3-4 (2 rows, ROW_NUMBER=2)
const precedingFollowing = await db.query(
  "SELECT id, score, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS rn FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  precedingFollowing.rows.map((row) => [row.id, row.score, row.rn]),
  [
    [1, 100, 1],
    [2, 200, 2],
    [3, 300, 2],
    [4, 400, 2],
  ],
);

// ROW_NUMBER with ROWS BETWEEN 0 PRECEDING AND 0 FOLLOWING (current row only)
const currentOnly = await db.query(
  "SELECT id, score, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN CURRENT ROW AND CURRENT ROW) AS rn FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  currentOnly.rows.map((row) => [row.id, row.score, row.rn]),
  [
    [1, 100, 1],
    [2, 200, 1],
    [3, 300, 1],
    [4, 400, 1],
  ],
);

// LAG with frame bounds
const lagWithFrame = await db.query(
  "SELECT id, score, LAG(score) OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  lagWithFrame.rows.map((row) => [row.id, row.score, row.prev]),
  [
    [1, 100, null],
    [2, 200, 100],
    [3, 300, 200],
    [4, 400, 300],
  ],
);

// LEAD with frame bounds
const leadWithFrame = await db.query(
  "SELECT id, score, LEAD(score) OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS next FROM p4_win005_scores WHERE grp = 'A' ORDER BY score",
);
assert.deepEqual(
  leadWithFrame.rows.map((row) => [row.id, row.score, row.next]),
  [
    [1, 100, 200],
    [2, 200, 300],
    [3, 300, 400],
    [4, 400, null],
  ],
);

// Parser test - verify frame AST is parsed correctly
const ast = parseSqlToAst(
  "SELECT ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rn FROM p4_win005_scores",
);
assert.equal(ast.kind, "select");
if (ast.kind === "select") {
  const rowNumItem = ast.selectItems[0];
  assert.ok(rowNumItem?.window, "window function must exist");
  assert.ok(rowNumItem?.window?.over.frame, "frame must be parsed");
  assert.equal(rowNumItem?.window?.over.frame?.unit, "ROWS");
  assert.equal(rowNumItem?.window?.over.frame?.start.kind, "unbounded_preceding");
  assert.equal(rowNumItem?.window?.over.frame?.end.kind, "current_row");
}

// Checklist check
const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-WIN-005\b/.test(checklist), false, "P4-WIN-005 must be checked");

console.log("ok: P4-WIN-005 ROWS BETWEEN window frame semantics");
