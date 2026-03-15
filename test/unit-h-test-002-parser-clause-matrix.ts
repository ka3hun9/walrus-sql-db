import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

const fromVariants = [
  "users u",
  "users u INNER JOIN orders o ON u.id = o.user_id",
  "users u LEFT JOIN orders o ON u.id = o.user_id",
  "users u RIGHT JOIN orders o ON u.id = o.user_id",
  "users u FULL OUTER JOIN orders o ON u.id = o.user_id",
];

const clauses = [
  { key: "where", sql: "WHERE u.id >= 1" },
  { key: "group", sql: "GROUP BY u.id" },
  { key: "having", sql: "HAVING COUNT(*) > 0" },
  { key: "order", sql: "ORDER BY u.id DESC" },
  { key: "limit", sql: "LIMIT 10" },
  { key: "offset", sql: "OFFSET 2" },
] as const;

for (const from of fromVariants) {
  for (let mask = 0; mask < 2 ** clauses.length; mask++) {
    const selected = clauses.filter((_, idx) => ((mask >> idx) & 1) === 1);
    const hasGroup = selected.some((c) => c.key === "group");
    const hasHaving = selected.some((c) => c.key === "having");
    if (hasHaving && !hasGroup) continue;

    const sql = `SELECT u.id FROM ${from}${selected.length ? ` ${selected.map((c) => c.sql).join(" ")}` : ""}`;
    const ast = parseSqlToAst(sql, { dialect: "ansi" });
    assert.equal(ast.kind, "select");
  }
}

const invalidOrderSql = [
  "SELECT id FROM users ORDER BY id WHERE id > 1",
  "SELECT id FROM users LIMIT 5 ORDER BY id",
  "SELECT id FROM users OFFSET 2 GROUP BY id",
];

for (const sql of invalidOrderSql) {
  assert.throws(
    () => parseSqlToAst(sql, { dialect: "ansi" }),
    (err: unknown) =>
      err instanceof SqlEngineError
      && err.family === "SQL_SYNTAX"
      && err.code.startsWith("SQL_SYNTAX_"),
  );
}

console.log("ok: H-TEST-002 parser clause matrix (cartesian combinations)");
