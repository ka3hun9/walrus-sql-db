import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astBetween = parseSqlToAst("SELECT id FROM t WHERE v BETWEEN 1 AND 5");
assert.equal(astBetween.kind, "select");
assert.equal(astBetween.where?.kind, "binary");
if (astBetween.where?.kind === "binary") {
  assert.equal(astBetween.where.op.toUpperCase(), "BETWEEN");
}

const astNotBetween = parseSqlToAst("SELECT id FROM t WHERE v NOT BETWEEN 1 AND 5");
assert.equal(astNotBetween.kind, "select");
assert.equal(astNotBetween.where?.kind, "binary");
if (astNotBetween.where?.kind === "binary") {
  assert.equal(astNotBetween.where.op.toUpperCase(), "NOT BETWEEN");
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_between (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_between (id, v) VALUES (1, 1)");
await db.execute("INSERT INTO t_between (id, v) VALUES (2, 3)");
await db.execute("INSERT INTO t_between (id, v) VALUES (3, 5)");
await db.execute("INSERT INTO t_between (id, v) VALUES (4, 7)");
await db.execute("INSERT INTO t_between (id, v) VALUES (5, NULL)");

const between = await db.query("SELECT id FROM t_between WHERE v BETWEEN 2 AND 5 ORDER BY id");
assert.deepEqual(
  between.rows.map((r) => r.id),
  [2, 3],
);

const notBetween = await db.query("SELECT id FROM t_between WHERE v NOT BETWEEN 2 AND 5 ORDER BY id");
assert.deepEqual(
  notBetween.rows.map((r) => r.id),
  [1, 4],
);

console.log("ok: B-PARSE-005 BETWEEN / NOT BETWEEN parsing");
