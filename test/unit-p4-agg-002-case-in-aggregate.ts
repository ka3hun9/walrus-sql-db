import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { parseSqlToAst } from "../src/sql-parser.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p4_agg002_t (id INT PRIMARY KEY, grp TEXT, status TEXT, val INT)");
await db.execute("INSERT INTO p4_agg002_t (id, grp, status, val) VALUES (1, 'X', 'active',   100)");
await db.execute("INSERT INTO p4_agg002_t (id, grp, status, val) VALUES (2, 'X', 'active',   200)");
await db.execute("INSERT INTO p4_agg002_t (id, grp, status, val) VALUES (3, 'X', 'inactive', 300)");
await db.execute("INSERT INTO p4_agg002_t (id, grp, status, val) VALUES (4, 'Y', 'active',   400)");
await db.execute("INSERT INTO p4_agg002_t (id, grp, status, val) VALUES (5, 'Y', 'inactive', 150)");

// --- Parser AST checks ---
const ast = parseSqlToAst(
  "SELECT SUM(CASE WHEN status = 'active' THEN val ELSE 0 END) FROM p4_agg002_t",
  { dialect: "ansi" },
);
assert.equal(ast.kind, "select", "parsed as select");
if (ast.kind === "select") {
  const item = ast.selectItems[0]!;
  assert.equal(item.expr.kind, "function", "outer is function");
  if (item.expr.kind === "function") {
    assert.equal(item.expr.name, "SUM", "function is SUM");
    assert.equal(item.expr.args[0]?.kind, "case", "arg is CASE");
  }
}
console.log("ok: CASE WHEN AST parsed correctly inside SUM");

// --- SUM(CASE WHEN ... THEN ... ELSE 0 END) ---
// active vals: 100 + 200 + 400 = 700, inactive mapped to 0
const sumCase = await db.query(
  "SELECT SUM(CASE WHEN status = 'active' THEN val ELSE 0 END) FROM p4_agg002_t",
);
const sumVal = Object.values(sumCase.rows[0]!)[0] as number;
assert.equal(sumVal, 700, `Expected SUM=700, got ${sumVal}`);
console.log("ok: SUM(CASE WHEN ... THEN val ELSE 0 END) = 700");

// --- COUNT(CASE WHEN ... THEN 1 END) — no ELSE, so inactive rows return NULL (uncounted) ---
const cntCase = await db.query(
  "SELECT COUNT(CASE WHEN status = 'active' THEN 1 END) FROM p4_agg002_t",
);
const cntVal = Object.values(cntCase.rows[0]!)[0] as number;
assert.equal(cntVal, 3, `Expected COUNT=3 (active rows), got ${cntVal}`);
console.log("ok: COUNT(CASE WHEN ... THEN 1 END) = 3 (NULL rows excluded)");

// --- SUM(CASE WHEN ... THEN val END) with NULL for non-match ---
// active vals: 100+200+400 = 700, NULL vals skipped
const sumNoElse = await db.query(
  "SELECT SUM(CASE WHEN status = 'active' THEN val END) FROM p4_agg002_t",
);
const sumNoElseVal = Object.values(sumNoElse.rows[0]!)[0] as number;
assert.equal(sumNoElseVal, 700, `Expected SUM=700 (nulls skipped), got ${sumNoElseVal}`);
console.log("ok: SUM(CASE WHEN ... THEN val END) = 700 (NULL ELSE skipped)");

// --- CASE with no matching rows yields NULL ---
const sumNone = await db.query(
  "SELECT SUM(CASE WHEN status = 'deleted' THEN val ELSE 0 END) FROM p4_agg002_t",
);
// All rows map to 0, SUM = 0
const sumNoneVal = Object.values(sumNone.rows[0]!)[0] as number;
assert.equal(sumNoneVal, 0, `Expected SUM=0, got ${sumNoneVal}`);
console.log("ok: SUM(CASE WHEN no-match THEN val ELSE 0 END) = 0");

// --- GROUP BY with CASE WHEN inside SUM ---
const groupCase = await db.query(
  "SELECT grp, SUM(CASE WHEN status = 'active' THEN val ELSE 0 END) FROM p4_agg002_t GROUP BY grp ORDER BY grp",
);
// grp X: active (100+200) + inactive→0 = 300
// grp Y: active (400) + inactive→0 = 400
assert.equal(groupCase.rows.length, 2, "Two groups");
const rowX = groupCase.rows.find((r) => r["grp"] === "X")!;
const rowY = groupCase.rows.find((r) => r["grp"] === "Y")!;
const sumX = Object.values(rowX).find((v) => typeof v === "number" && v !== rowX["id"]) as number;
const sumY = Object.values(rowY).find((v) => typeof v === "number" && v !== rowY["id"]) as number;
assert.equal(sumX, 300, `Expected grp X sum=300, got ${sumX}`);
assert.equal(sumY, 400, `Expected grp Y sum=400, got ${sumY}`);
console.log("ok: GROUP BY grp SUM(CASE...) X=300, Y=400");

console.log("\nok: P4-AGG-002 CASE WHEN in aggregate expressions");
