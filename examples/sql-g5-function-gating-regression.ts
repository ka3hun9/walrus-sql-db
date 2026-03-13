import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

function expectCode(fn: () => unknown, code: string) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, code);
}

function expectParseOk(sql: string, dialect: "ansi" | "sqlite" | "postgres" | "mysql" | "sqlserver") {
  const ast = parseSqlToAst(sql, { dialect });
  assert.ok(ast.kind === "select" || ast.kind === "union");
}

function main() {
  // allowed in owning dialects
  expectParseOk("SELECT IFNULL(name, 'n/a') FROM users", "mysql");
  expectParseOk("SELECT ISNULL(name, 'n/a') FROM users", "sqlserver");
  expectParseOk("SELECT IIF(score > 0, 1, 0) FROM users", "sqlserver");
  expectParseOk("SELECT DATE_TRUNC('day', created_at) FROM users", "postgres");
  expectParseOk("SELECT PRINTF('%s', name) FROM users", "sqlite");

  // rejected in non-owning dialects
  expectCode(() => parseSqlToAst("SELECT IFNULL(name, 'n/a') FROM users", { dialect: "ansi" }), "SQL_DIALECT_UNSUPPORTED_FUNCTION");
  expectCode(() => parseSqlToAst("SELECT ISNULL(name, 'n/a') FROM users", { dialect: "mysql" }), "SQL_DIALECT_UNSUPPORTED_FUNCTION");
  expectCode(() => parseSqlToAst("SELECT IIF(score > 0, 1, 0) FROM users", { dialect: "postgres" }), "SQL_DIALECT_UNSUPPORTED_FUNCTION");
  expectCode(() => parseSqlToAst("SELECT DATE_TRUNC('day', created_at) FROM users", { dialect: "sqlserver" }), "SQL_DIALECT_UNSUPPORTED_FUNCTION");
  expectCode(() => parseSqlToAst("SELECT PRINTF('%s', name) FROM users", { dialect: "mysql" }), "SQL_DIALECT_UNSUPPORTED_FUNCTION");

  console.log("sql-g5-function-gating-regression ok");
}

main();
