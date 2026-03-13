import { strict as assert } from "node:assert";
import { createSqlError } from "../src/sql-errors.js";

const err = createSqlError("SQL_SEMANTIC_TYPE_MISMATCH", {
  message: "type mismatch",
  token: "+",
});

assert.equal(err.code, "SQL_SEMANTIC_TYPE_MISMATCH");
assert.equal(err.family, "SQL_SEMANTIC");
assert.equal(err.details?.token, "+");

const syntaxErr = createSqlError("SQL_SYNTAX_UNEXPECTED_TOKEN", {
  message: "unexpected token",
});
assert.equal(syntaxErr.family, "SQL_SYNTAX");

const dialectErr = createSqlError("SQL_DIALECT_UNSUPPORTED_FUNCTION", {
  message: "unsupported function",
  dialect: "sqlite",
});
assert.equal(dialectErr.family, "SQL_DIALECT");
assert.equal(dialectErr.details?.dialect, "sqlite");

console.log("sql-errors-contract ok");
