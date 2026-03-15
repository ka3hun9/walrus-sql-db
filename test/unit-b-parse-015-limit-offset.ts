import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const ast = parseSqlToAst("SELECT id FROM t ORDER BY id LIMIT 2 OFFSET 1");
assert.equal(ast.kind, "select");
assert.equal(ast.limit, 2);
assert.equal(ast.offset, 1);

assert.throws(() => parseSqlToAst("SELECT id FROM t LIMIT 1 ORDER BY id"), (err: unknown) => {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "SQL_SYNTAX_INVALID_CLAUSE_ORDER");
});

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_limit (id INT PRIMARY KEY)");
await db.execute("INSERT INTO t_limit (id) VALUES (1)");
await db.execute("INSERT INTO t_limit (id) VALUES (2)");
await db.execute("INSERT INTO t_limit (id) VALUES (3)");
await db.execute("INSERT INTO t_limit (id) VALUES (4)");

const paged = await db.query("SELECT id FROM t_limit ORDER BY id LIMIT 2 OFFSET 1");
assert.deepEqual(
  paged.rows.map((r) => r.id),
  [2, 3],
);

console.log("ok: B-PARSE-015 LIMIT/OFFSET parsing and clause order checks");
