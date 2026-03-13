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
  // owner dialect acceptance (parse-level)
  expectParseOk("SELECT id FROM users WHERE name ILIKE 'a%'", "postgres");
  expectParseOk("SELECT id FROM users WHERE name REGEXP '^a'", "mysql");
  expectParseOk("SELECT id FROM users WHERE name REGEXP '^a'", "sqlite");
  expectParseOk("SELECT id FROM users WHERE name ~ '^a'", "postgres");

  // non-owner rejection
  expectCode(() => parseSqlToAst("SELECT id FROM users WHERE name ILIKE 'a%'", { dialect: "mysql" }), "SQL_DIALECT_UNSUPPORTED_OPERATOR");
  expectCode(() => parseSqlToAst("SELECT id FROM users WHERE name REGEXP '^a'", { dialect: "postgres" }), "SQL_DIALECT_UNSUPPORTED_OPERATOR");
  expectCode(() => parseSqlToAst("SELECT id FROM users WHERE name ~ '^a'", { dialect: "sqlserver" }), "SQL_DIALECT_UNSUPPORTED_OPERATOR");

  console.log("sql-g5-operator-gating-regression ok");
}

main();
