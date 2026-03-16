import { strict as assert } from "node:assert";
import { parseSqlToAst, parseSqlToAstWithMeta } from "../src/parser/index.js";
import { SqlEngineError } from "../src/sql-errors.js";

const begin = parseSqlToAst("BEGIN");
assert.equal(begin.kind, "transaction");
assert.equal(begin.action, "BEGIN");
assert.equal(begin.nestedTransactionPolicy, "error_on_nested_begin");

const beginWork = parseSqlToAst("BEGIN WORK");
assert.equal(beginWork.kind, "transaction");
assert.equal(beginWork.action, "BEGIN");

const beginTransaction = parseSqlToAst("BEGIN TRANSACTION");
assert.equal(beginTransaction.kind, "transaction");
assert.equal(beginTransaction.action, "BEGIN");

const commit = parseSqlToAst("COMMIT");
assert.equal(commit.kind, "transaction");
assert.equal(commit.action, "COMMIT");

const commitWork = parseSqlToAst("COMMIT WORK");
assert.equal(commitWork.kind, "transaction");
assert.equal(commitWork.action, "COMMIT");

const rollback = parseSqlToAst("ROLLBACK");
assert.equal(rollback.kind, "transaction");
assert.equal(rollback.action, "ROLLBACK");

const rollbackWork = parseSqlToAst("ROLLBACK WORK");
assert.equal(rollbackWork.kind, "transaction");
assert.equal(rollbackWork.action, "ROLLBACK");

const beginWithMeta = parseSqlToAstWithMeta("BEGIN");
assert.equal(beginWithMeta.grammar.statement, "transaction");
assert.equal(beginWithMeta.ast.kind, "transaction");

assert.throws(
  () => parseSqlToAst("BEGIN NESTED"),
  (err: unknown) => {
    return Boolean(
      err instanceof SqlEngineError
      && err.code === "SQL_DIALECT_UNSUPPORTED_SYNTAX"
      && /nested/i.test(err.details?.message ?? "")
      && (err.details?.hint ?? "").includes("nestedPolicy=error_on_nested_begin"),
    );
  },
);

assert.throws(
  () => parseSqlToAst("COMMIT NOW"),
  (err: unknown) => Boolean(err instanceof SqlEngineError && err.code === "SQL_DIALECT_UNSUPPORTED_SYNTAX"),
);

assert.throws(
  () => parseSqlToAst("ROLLBACK TO SAVEPOINT s1"),
  (err: unknown) => Boolean(err instanceof SqlEngineError && err.code === "SQL_DIALECT_UNSUPPORTED_SYNTAX"),
);

console.log("ok: B-PARSE-016 transaction control statements and nested policy declaration");
