import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";
import { inspectSqlGrammarSkeleton } from "../src/sql-grammar-skeleton.js";

function mustThrowDialect(sql: string, dialect: "ansi" | "sqlite" | "postgres" | "mysql" | "sqlserver") {
  let err: unknown;
  try {
    parseSqlToAst(sql, { dialect });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
}

function main() {
  // hard-blocked in non-target dialects
  mustThrowDialect("SELECT TOP 3 id FROM users", "ansi");
  mustThrowDialect("SELECT TOP 3 id FROM users", "sqlite");
  mustThrowDialect("SELECT TOP 3 id FROM users", "postgres");
  mustThrowDialect("SELECT TOP 3 id FROM users", "mysql");

  mustThrowDialect("SELECT id FROM users FETCH FIRST 3 ROWS ONLY", "ansi");
  mustThrowDialect("SELECT id FROM users FETCH FIRST 3 ROWS ONLY", "sqlite");

  // staged-recognition in target dialect profile (syntax execution not enabled yet)
  const ss = inspectSqlGrammarSkeleton("SELECT TOP 3 id FROM users", { dialect: "sqlserver" });
  assert.equal(ss.unsupported.some((u) => u.feature === "top"), false);

  const pg = inspectSqlGrammarSkeleton("SELECT id FROM users FETCH FIRST 3 ROWS ONLY", { dialect: "postgres" });
  assert.equal(pg.unsupported.some((u) => u.feature === "fetch"), false);

  console.log("sql-g5-dialect-gating-regression ok");
}

main();
