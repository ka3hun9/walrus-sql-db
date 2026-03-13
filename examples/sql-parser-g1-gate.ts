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

console.log("sql-parser-g1-gate ok");
