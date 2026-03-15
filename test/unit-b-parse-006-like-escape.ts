import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astLike = parseSqlToAst("SELECT id FROM t WHERE name LIKE 'A!_%' ESCAPE '!'");
assert.equal(astLike.kind, "select");
assert.ok(astLike.where, "LIKE with ESCAPE should parse");
if (astLike.where?.kind === "raw") {
  assert.match(astLike.where.text, /\bLIKE\b[\s\S]*\bESCAPE\b/i);
}

const astNotLike = parseSqlToAst("SELECT id FROM t WHERE name NOT LIKE 'A!_%' ESCAPE '!'");
assert.equal(astNotLike.kind, "select");
assert.ok(astNotLike.where, "NOT LIKE with ESCAPE should parse");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_like (id INT PRIMARY KEY, name TEXT)");
await db.execute("INSERT INTO t_like (id, name) VALUES (1, 'A_1')");
await db.execute("INSERT INTO t_like (id, name) VALUES (2, 'A11')");
await db.execute("INSERT INTO t_like (id, name) VALUES (3, 'A%1')");
await db.execute("INSERT INTO t_like (id, name) VALUES (4, 'A_')");
await db.execute("INSERT INTO t_like (id, name) VALUES (5, NULL)");

const like = await db.query("SELECT id FROM t_like WHERE name LIKE 'A!_%' ESCAPE '!' ORDER BY id");
assert.deepEqual(
  like.rows.map((r) => r.id),
  [1, 4],
);

const notLike = await db.query("SELECT id FROM t_like WHERE name NOT LIKE 'A!_%' ESCAPE '!' ORDER BY id");
assert.deepEqual(
  notLike.rows.map((r) => r.id),
  [2, 3],
);

console.log("ok: B-PARSE-006 LIKE / NOT LIKE with ESCAPE");
