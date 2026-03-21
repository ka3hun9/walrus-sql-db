import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

{
  const ast = parseSqlToAst("CREATE INDEX idx_users_email ON users(email)");
  assert.equal(ast.kind, "create_index");
  if (ast.kind === "create_index") {
    assert.equal(ast.indexName, "idx_users_email");
    assert.equal(ast.tableName, "users");
    assert.deepEqual(ast.columns, ["email"]);
    assert.equal(ast.unique, false);
  }
}

{
  const ast = parseSqlToAst("CREATE UNIQUE INDEX idx_orders_uid_ct ON orders(user_id, created_at)");
  assert.equal(ast.kind, "create_index");
  if (ast.kind === "create_index") {
    assert.equal(ast.unique, true);
    assert.deepEqual(ast.columns, ["user_id", "created_at"]);
  }
}

{
  const ast = parseSqlToAst("DROP INDEX idx_users_email");
  assert.equal(ast.kind, "drop_index");
  if (ast.kind === "drop_index") {
    assert.equal(ast.indexName, "idx_users_email");
    assert.equal(ast.ifExists, false);
    assert.equal(ast.tableName, undefined);
  }
}

{
  const ast = parseSqlToAst("DROP INDEX IF EXISTS idx_users_email ON users");
  assert.equal(ast.kind, "drop_index");
  if (ast.kind === "drop_index") {
    assert.equal(ast.ifExists, true);
    assert.equal(ast.tableName, "users");
  }
}

assert.throws(
  () => parseSqlToAst("CREATE INDEX idx_bad ON users()"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_INCOMPLETE_STATEMENT",
);

assert.throws(
  () => parseSqlToAst("DROP INDEX"),
  (err: unknown) => err instanceof SqlEngineError && err.code === "SQL_SYNTAX_INCOMPLETE_STATEMENT",
);

console.log("ok: P3-IDX-001 create/drop index parser baseline");
