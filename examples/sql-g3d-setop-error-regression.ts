import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

function mustError(sql: string, code: string) {
  let err: unknown;
  try {
    parseSqlToAst(sql);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, code);
}

function main() {
  mustError("SELECT id FROM t UNION", "SQL_SYNTAX_INCOMPLETE_STATEMENT");
  mustError("SELECT id FROM t UNION ORDER BY id", "SQL_SYNTAX_INCOMPLETE_STATEMENT");
  mustError("SELECT id FROM t UNION ALL LIMIT 1", "SQL_SYNTAX_INCOMPLETE_STATEMENT");
  mustError("SELECT id FROM t UNION WHERE id > 1", "SQL_SYNTAX_INCOMPLETE_STATEMENT");

  console.log("sql-g3d-setop-error-regression ok");
}

main();
