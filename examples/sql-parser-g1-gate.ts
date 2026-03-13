import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

const ok = parseSqlToAst("SELECT id FROM users WHERE id > 1 ORDER BY id LIMIT 3");
assert.equal(ok.kind, "select");

let topErr: unknown;
try {
  parseSqlToAst("SELECT TOP 5 id FROM users");
} catch (e) {
  topErr = e;
}
assert.ok(topErr instanceof SqlEngineError);
assert.equal((topErr as SqlEngineError).code, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
assert.equal((topErr as SqlEngineError).details?.token, "top");

let cteErr: unknown;
try {
  parseSqlToAst("WITH x AS (SELECT 1) SELECT * FROM x");
} catch (e) {
  cteErr = e;
}
assert.ok(cteErr instanceof SqlEngineError);
assert.equal((cteErr as SqlEngineError).code, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
assert.equal((cteErr as SqlEngineError).details?.token, "cte");

let malformedFrom: unknown;
try {
  parseSqlToAst("SELECT id users WHERE id > 1");
} catch (e) {
  malformedFrom = e;
}
assert.ok(malformedFrom instanceof SqlEngineError);
assert.equal((malformedFrom as SqlEngineError).code, "SQL_SYNTAX_INCOMPLETE_STATEMENT");

let badOrder: unknown;
try {
  parseSqlToAst("SELECT id FROM users LIMIT 2 WHERE id > 1");
} catch (e) {
  badOrder = e;
}
assert.ok(badOrder instanceof SqlEngineError);
assert.equal((badOrder as SqlEngineError).code, "SQL_SYNTAX_INVALID_CLAUSE_ORDER");

let nonSelect: unknown;
try {
  parseSqlToAst("DELETE FROM users WHERE id = 1");
} catch (e) {
  nonSelect = e;
}
assert.ok(nonSelect instanceof SqlEngineError);
assert.equal((nonSelect as SqlEngineError).code, "SQL_DIALECT_UNSUPPORTED_SYNTAX");

console.log("sql-parser-g1-gate ok");
