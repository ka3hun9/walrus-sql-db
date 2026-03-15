import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astMulti = parseSqlToAst("SELECT id, score FROM t ORDER BY score DESC, id ASC");
assert.equal(astMulti.kind, "select");
assert.equal(astMulti.orderBy?.length, 2);
assert.equal(astMulti.orderBy?.[0]?.direction, "DESC");
assert.equal(astMulti.orderBy?.[1]?.direction, "ASC");

const astAlias = parseSqlToAst("SELECT score AS s FROM t ORDER BY s DESC");
assert.equal(astAlias.kind, "select");
assert.equal(astAlias.orderBy?.length, 1);
assert.equal(astAlias.orderBy?.[0]?.expr.kind, "identifier");

const astExpr = parseSqlToAst("SELECT id, score FROM t ORDER BY score + tax DESC");
assert.equal(astExpr.kind, "select");
assert.equal(astExpr.orderBy?.length, 1);
assert.equal(astExpr.orderBy?.[0]?.expr.kind, "binary");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_order (id INT PRIMARY KEY, score INT, tax INT)");
await db.execute("INSERT INTO t_order (id, score, tax) VALUES (1, 90, 3)");
await db.execute("INSERT INTO t_order (id, score, tax) VALUES (2, 90, 1)");
await db.execute("INSERT INTO t_order (id, score, tax) VALUES (3, 80, 5)");

const ordered = await db.query("SELECT id FROM t_order ORDER BY score DESC, id ASC");
assert.deepEqual(
  ordered.rows.map((r) => r.id),
  [1, 2, 3],
);

console.log("ok: B-PARSE-014 ORDER BY multi-key/ASC-DESC/alias/expression parsing");
