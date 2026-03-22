import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";
import { exprAstToSql } from "../src/sql-ast-eval.js";
import { parseSqlToAst } from "../src/sql-parser.js";

{
  const ast = parseSqlToAst(
    "SELECT grp, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score DESC, id ASC) AS rn FROM p4_win001_scores",
  );
  assert.equal(ast.kind, "select");

  if (ast.kind === "select") {
    const rowNumberItem = ast.selectItems[1];
    assert.ok(rowNumberItem, "ROW_NUMBER select item must exist");
    assert.equal(rowNumberItem?.alias, "rn");
    assert.equal(rowNumberItem?.window?.kind, "window_function");
    assert.equal(rowNumberItem?.window?.name, "ROW_NUMBER");
    assert.deepEqual(rowNumberItem?.window?.args ?? [], []);
    assert.equal(rowNumberItem?.window?.over.partitionBy.length, 1);
    assert.equal(exprAstToSql(rowNumberItem?.window?.over.partitionBy[0]), "grp");
    assert.equal(rowNumberItem?.window?.over.orderBy.length, 2);
    assert.equal(exprAstToSql(rowNumberItem?.window?.over.orderBy[0]?.expr), "score");
    assert.equal(rowNumberItem?.window?.over.orderBy[0]?.direction, "DESC");
    assert.equal(exprAstToSql(rowNumberItem?.window?.over.orderBy[1]?.expr), "id");
    assert.equal(rowNumberItem?.window?.over.orderBy[1]?.direction, "ASC");
  }
}

assert.throws(
  () => parseSqlToAst("SELECT ROW_NUMBER() OVER () AS rn FROM p4_win001_scores"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_INCOMPLETE_STATEMENT",
);

assert.throws(
  () => parseSqlToAst("SELECT ROW_NUMBER() OVER (PARTITION grp ORDER BY id) AS rn FROM p4_win001_scores"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_INCOMPLETE_STATEMENT",
);

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_win001_scores (id INT PRIMARY KEY, grp TEXT, score INT)");
await db.execute("INSERT INTO p4_win001_scores (id, grp, score) VALUES (1, 'A', 80)");
await db.execute("INSERT INTO p4_win001_scores (id, grp, score) VALUES (2, 'A', 90)");
await db.execute("INSERT INTO p4_win001_scores (id, grp, score) VALUES (3, 'B', 50)");
await db.execute("INSERT INTO p4_win001_scores (id, grp, score) VALUES (4, 'B', 50)");

const partitioned = await db.query(
  "SELECT grp, id, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score DESC, id ASC) AS rn FROM p4_win001_scores ORDER BY grp ASC, rn ASC",
);
assert.deepEqual(
  partitioned.rows.map((row) => [row.grp, row.id, row.rn]),
  [
    ["A", 2, 1],
    ["A", 1, 2],
    ["B", 3, 1],
    ["B", 4, 2],
  ],
);

const globalOrder = await db.query(
  "SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, id ASC) AS rn FROM p4_win001_scores ORDER BY rn ASC",
);
assert.deepEqual(
  globalOrder.rows.map((row) => [row.id, row.rn]),
  [
    [2, 1],
    [1, 2],
    [3, 3],
    [4, 4],
  ],
);

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-WIN-001\b/.test(checklist), false, "P4-WIN-001 must be checked");

const reportDoc = readFileSync("docs/sql-p4-win-001-window-over-parser-binding.md", "utf8");
assert.ok(reportDoc.includes("## P4-WIN-001"));
assert.ok(reportDoc.includes("OVER (PARTITION BY ... ORDER BY ...)"));
assert.ok(reportDoc.includes("test/unit-p4-win-001-window-over-parser-binding.ts"));

console.log("ok: P4-WIN-001 OVER(PARTITION BY ... ORDER BY ...) parser binding");
