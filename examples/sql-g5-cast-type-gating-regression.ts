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
  assert.equal(ast.kind, "select");
}

function main() {
  // owning dialects
  expectParseOk("SELECT CAST(score AS UNSIGNED) FROM users", "mysql");
  expectParseOk("SELECT CAST(name AS NVARCHAR) FROM users", "sqlserver");
  expectParseOk("SELECT CAST(blob_col AS BYTEA) FROM users", "postgres");
  expectParseOk("SELECT CAST(name AS NONE) FROM users", "sqlite");

  // cross-dialect rejection
  expectCode(
    () => parseSqlToAst("SELECT CAST(score AS UNSIGNED) FROM users", { dialect: "postgres" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );
  expectCode(
    () => parseSqlToAst("SELECT CAST(name AS NVARCHAR) FROM users", { dialect: "mysql" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );
  expectCode(
    () => parseSqlToAst("SELECT CAST(blob_col AS BYTEA) FROM users", { dialect: "sqlserver" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );
  expectCode(
    () => parseSqlToAst("SELECT CAST(name AS NONE) FROM users", { dialect: "ansi" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );

  console.log("sql-g5-cast-type-gating-regression ok");
}

main();
