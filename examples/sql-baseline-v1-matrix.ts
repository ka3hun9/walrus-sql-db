import { strict as assert } from "node:assert";
import { parseSqlToAstWithMeta } from "../src/sql-parser.js";
import { SqlEngineError, type SqlErrorCode } from "../src/sql-errors.js";

type Case = {
  name: string;
  sql: string;
  expect: "pass" | "fail";
  code?: SqlErrorCode;
};

const cases: Case[] = [
  {
    name: "baseline-select-pass",
    sql: "SELECT id FROM users WHERE id > 1 ORDER BY id LIMIT 10 OFFSET 1",
    expect: "pass",
  },
  {
    name: "baseline-union-pass",
    sql: "SELECT id FROM users UNION ALL SELECT id FROM users",
    expect: "pass",
  },
  {
    name: "unsupported-cte",
    sql: "WITH x AS (SELECT 1) SELECT * FROM x",
    expect: "fail",
    code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  },
  {
    name: "unsupported-top",
    sql: "SELECT TOP 5 id FROM users",
    expect: "fail",
    code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  },
  {
    name: "unsupported-fetch",
    sql: "SELECT id FROM users ORDER BY id FETCH FIRST 5 ROWS ONLY",
    expect: "fail",
    code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  },
  {
    name: "invalid-clause-order",
    sql: "SELECT id FROM users LIMIT 2 WHERE id > 1",
    expect: "fail",
    code: "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  },
  {
    name: "incomplete-from",
    sql: "SELECT id users WHERE id > 1",
    expect: "fail",
    code: "SQL_SYNTAX_INCOMPLETE_STATEMENT",
  },
  {
    name: "non-select-statement",
    sql: "DELETE FROM users WHERE id = 1",
    expect: "fail",
    code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  },
];

for (const c of cases) {
  let gotError: SqlEngineError | undefined;
  try {
    const { ast, grammar } = parseSqlToAstWithMeta(c.sql);
    if (c.expect === "fail") {
      throw new Error(`${c.name}: expected failure but parsed kind=${ast.kind}`);
    }
    assert.ok(grammar.statement === "select" || grammar.statement === "union");
  } catch (e) {
    if (e instanceof SqlEngineError) gotError = e;
    else throw e;
  }

  if (c.expect === "pass") {
    assert.equal(gotError, undefined, `${c.name}: expected pass, got ${gotError?.code}`);
  } else {
    assert.ok(gotError, `${c.name}: expected failure`);
    assert.equal(gotError!.code, c.code, `${c.name}: unexpected error code`);
  }
}

console.log(`sql-baseline-v1-matrix ok (${cases.length} cases)`);
