import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { WalrusSqlClient } from "../src/client.js";
import { exprAstToSql } from "../src/sql-ast-eval.js";
import { parseSqlToAst } from "../src/sql-parser.js";

{
  const ast = parseSqlToAst(
    "SELECT grp, id, RANK() OVER (PARTITION BY grp ORDER BY score DESC) AS rnk, DENSE_RANK() OVER (PARTITION BY grp ORDER BY score DESC) AS dr FROM p4_win003_scores",
  );
  assert.equal(ast.kind, "select");

  if (ast.kind === "select") {
    const rankItem = ast.selectItems[2];
    const denseRankItem = ast.selectItems[3];

    assert.ok(rankItem, "RANK select item must exist");
    assert.ok(denseRankItem, "DENSE_RANK select item must exist");

    assert.equal(rankItem?.alias, "rnk");
    assert.equal(rankItem?.window?.kind, "window_function");
    assert.equal(rankItem?.window?.name, "RANK");
    assert.deepEqual(rankItem?.window?.args ?? [], []);
    assert.equal(rankItem?.window?.over.partitionBy.length, 1);
    assert.equal(exprAstToSql(rankItem?.window?.over.partitionBy[0]), "grp");
    assert.equal(rankItem?.window?.over.orderBy.length, 1);
    assert.equal(exprAstToSql(rankItem?.window?.over.orderBy[0]?.expr), "score");
    assert.equal(rankItem?.window?.over.orderBy[0]?.direction, "DESC");

    assert.equal(denseRankItem?.alias, "dr");
    assert.equal(denseRankItem?.window?.kind, "window_function");
    assert.equal(denseRankItem?.window?.name, "DENSE_RANK");
    assert.deepEqual(denseRankItem?.window?.args ?? [], []);
    assert.equal(denseRankItem?.window?.over.partitionBy.length, 1);
    assert.equal(exprAstToSql(denseRankItem?.window?.over.partitionBy[0]), "grp");
    assert.equal(denseRankItem?.window?.over.orderBy.length, 1);
    assert.equal(exprAstToSql(denseRankItem?.window?.over.orderBy[0]?.expr), "score");
    assert.equal(denseRankItem?.window?.over.orderBy[0]?.direction, "DESC");
  }
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_win003_scores (id INT PRIMARY KEY, grp TEXT, score INT)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (1, 'A', 100)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (2, 'A', 100)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (3, 'A', 90)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (4, 'A', 80)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (5, 'B', 70)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (6, 'B', 70)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (7, 'B', 60)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (8, 'C', NULL)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (9, 'C', NULL)");
await db.execute("INSERT INTO p4_win003_scores (id, grp, score) VALUES (10, 'C', 10)");

const rankAndDenseRank = await db.query(
  "SELECT grp, id, score, RANK() OVER (PARTITION BY grp ORDER BY score DESC) AS rnk, DENSE_RANK() OVER (PARTITION BY grp ORDER BY score DESC) AS dr FROM p4_win003_scores ORDER BY grp ASC, rnk ASC, id ASC",
);
assert.deepEqual(
  rankAndDenseRank.rows.map((row) => [row.grp, row.id, row.score, row.rnk, row.dr]),
  [
    ["A", 1, 100, 1, 1],
    ["A", 2, 100, 1, 1],
    ["A", 3, 90, 3, 2],
    ["A", 4, 80, 4, 3],
    ["B", 5, 70, 1, 1],
    ["B", 6, 70, 1, 1],
    ["B", 7, 60, 3, 2],
    ["C", 10, 10, 1, 1],
    ["C", 8, null, 2, 2],
    ["C", 9, null, 2, 2],
  ],
);

const partitionOnly = await db.query(
  "SELECT id, RANK() OVER (PARTITION BY grp) AS rnk, DENSE_RANK() OVER (PARTITION BY grp) AS dr FROM p4_win003_scores WHERE grp = 'A' ORDER BY id ASC",
);
assert.deepEqual(
  partitionOnly.rows.map((row) => [row.id, row.rnk, row.dr]),
  [
    [1, 1, 1],
    [2, 1, 1],
    [3, 1, 1],
    [4, 1, 1],
  ],
);

const rowNumberRegression = await db.query(
  "SELECT id, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score DESC, id ASC) AS rn FROM p4_win003_scores WHERE grp = 'A' ORDER BY rn ASC",
);
assert.deepEqual(
  rowNumberRegression.rows.map((row) => [row.id, row.rn]),
  [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ],
);

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-WIN-003\b/.test(checklist), false, "P4-WIN-003 must be checked");

const reportDoc = readFileSync("docs/sql-p4-win-003-rank-dense-rank-semantics.md", "utf8");
assert.ok(reportDoc.includes("## P4-WIN-003"));
assert.ok(reportDoc.includes("RANK()"));
assert.ok(reportDoc.includes("DENSE_RANK()"));
assert.ok(reportDoc.includes("test/unit-p4-win-003-rank-dense-rank-semantics.ts"));

console.log("ok: P4-WIN-003 rank/dense-rank tie and gap semantics");
