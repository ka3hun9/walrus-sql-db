import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const ast = parseSqlToAst("SELECT id FROM t WHERE a = 1 OR b = 1 AND c = 1");
assert.equal(ast.kind, "select");
assert.equal(ast.where?.kind, "binary");
if (ast.where?.kind === "binary") {
  assert.equal(ast.where.op.toUpperCase(), "OR");
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_where (id INT PRIMARY KEY, a INT, b INT, c INT)");
await db.execute("INSERT INTO t_where (id, a, b, c) VALUES (1, 1, 0, 0)");
await db.execute("INSERT INTO t_where (id, a, b, c) VALUES (2, 0, 1, 1)");
await db.execute("INSERT INTO t_where (id, a, b, c) VALUES (3, 0, 1, 0)");
await db.execute("INSERT INTO t_where (id, a, b, c) VALUES (4, 1, 1, 1)");
await db.execute("INSERT INTO t_where (id, a, b, c) VALUES (5, 0, 0, 1)");

const qPrecedence = await db.query("SELECT id FROM t_where WHERE a = 1 OR b = 1 AND c = 1 ORDER BY id");
assert.deepEqual(
  qPrecedence.rows.map((r) => r.id),
  [1, 2, 4],
);

const qParen = await db.query("SELECT id FROM t_where WHERE (a = 1 OR b = 1) AND c = 1 ORDER BY id");
assert.deepEqual(
  qParen.rows.map((r) => r.id),
  [2, 4],
);

const qNotParen = await db.query("SELECT id FROM t_where WHERE NOT (a = 1 OR b = 1) ORDER BY id");
assert.deepEqual(
  qNotParen.rows.map((r) => r.id),
  [5],
);

const qNotPrecedence = await db.query("SELECT id FROM t_where WHERE NOT a = 1 OR b = 1 ORDER BY id");
assert.deepEqual(
  qNotPrecedence.rows.map((r) => r.id),
  [2, 3, 4, 5],
);

console.log("ok: B-PARSE-004 WHERE precedence and parentheses");
