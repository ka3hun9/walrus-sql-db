import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";
import { parseSqlToAst } from "../src/sql-parser.js";

{
  const ast = parseSqlToAst("CREATE VIEW v_users AS SELECT id, email FROM users WHERE id > 1");
  assert.equal(ast.kind, "create_view");
  if (ast.kind === "create_view") {
    assert.equal(ast.viewName, "v_users");
    assert.equal(ast.querySql, "SELECT id, email FROM users WHERE id > 1");
  }
}

{
  const ast = parseSqlToAst("DROP VIEW IF EXISTS v_users");
  assert.equal(ast.kind, "drop_view");
  if (ast.kind === "drop_view") {
    assert.equal(ast.viewName, "v_users");
    assert.equal(ast.ifExists, true);
  }
}

assert.throws(
  () => parseSqlToAst("CREATE VIEW v_bad AS DELETE FROM users"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_UNEXPECTED_TOKEN",
);

assert.throws(
  () => parseSqlToAst("DROP VIEW"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_INCOMPLETE_STATEMENT",
);

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE view_users (id INT PRIMARY KEY, email TEXT)");

await db.execute("CREATE VIEW v_users AS SELECT id, email FROM view_users");
{
  const all = db.getViewCatalog();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.name, "V_USERS");
  assert.equal(all[0]?.querySql, "SELECT id, email FROM view_users");
  assert.equal(all[0]?.status, "ACTIVE");
}

await assert.rejects(
  db.execute("CREATE VIEW v_users AS SELECT id FROM view_users"),
  /ERR_UNSUPPORTED_DDL: view already exists: v_users/,
);

await db.execute("DROP VIEW v_users");
assert.equal(db.getViewCatalog().length, 0);

await db.execute("DROP VIEW IF EXISTS missing_view");
await assert.rejects(
  db.execute("DROP VIEW missing_view"),
  /ERR_UNSUPPORTED_DDL: view not found: missing_view/,
);

console.log("ok: P3-VIEW-001 create/drop view parser + catalog metadata");
