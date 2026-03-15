import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astIn = parseSqlToAst("SELECT id FROM t WHERE v IN (1, 2, 3)");
assert.equal(astIn.kind, "select");
assert.equal(astIn.where?.kind, "binary");
if (astIn.where?.kind === "binary") {
  assert.equal(astIn.where.op.toUpperCase(), "IN");
}

const astNotIn = parseSqlToAst("SELECT id FROM t WHERE v NOT IN (1, 2, 3)");
assert.equal(astNotIn.kind, "select");
assert.equal(astNotIn.where?.kind, "binary");
if (astNotIn.where?.kind === "binary") {
  assert.equal(astNotIn.where.op.toUpperCase(), "NOT IN");
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_in (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_in (id, v) VALUES (1, 1)");
await db.execute("INSERT INTO t_in (id, v) VALUES (2, 2)");
await db.execute("INSERT INTO t_in (id, v) VALUES (3, 4)");
await db.execute("INSERT INTO t_in (id, v) VALUES (4, NULL)");

const inRows = await db.query("SELECT id FROM t_in WHERE v IN (1, 2, 3) ORDER BY id");
assert.deepEqual(
  inRows.rows.map((r) => r.id),
  [1, 2],
);

const notInRows = await db.query("SELECT id FROM t_in WHERE v NOT IN (1, 2, 3) ORDER BY id");
assert.deepEqual(
  notInRows.rows.map((r) => r.id),
  [3],
);

console.log("ok: B-PARSE-007 IN / NOT IN value-list parsing");
