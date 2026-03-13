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

function main() {
  // sqlserver: LIMIT rejected
  expectCode(
    () => parseSqlToAst("SELECT id FROM users ORDER BY id LIMIT 2", { dialect: "sqlserver" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );

  // sqlserver: OFFSET requires ORDER BY
  expectCode(
    () => parseSqlToAst("SELECT id FROM users OFFSET 1", { dialect: "sqlserver" }),
    "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  );

  // sqlserver: FETCH requires OFFSET and ORDER BY
  expectCode(
    () => parseSqlToAst("SELECT id FROM users ORDER BY id FETCH NEXT 1 ROW ONLY", { dialect: "sqlserver" }),
    "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  );

  // sqlserver: valid ORDER BY + OFFSET + FETCH shape
  const ok = parseSqlToAst("SELECT id FROM users ORDER BY id OFFSET 1 FETCH NEXT 1 ROW ONLY", {
    dialect: "sqlserver",
  });
  assert.equal(ok.kind, "select");
  assert.equal((ok as any).offset, 1);
  assert.equal((ok as any).limit, 1);

  console.log("sql-g5-clause-shape-regression ok");
}

main();
