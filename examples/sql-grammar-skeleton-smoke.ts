import { strict as assert } from "node:assert";
import { inspectSqlGrammarSkeleton } from "../src/sql-grammar-skeleton.js";

const s1 = inspectSqlGrammarSkeleton("SELECT id FROM users WHERE id > 1 ORDER BY id LIMIT 10 OFFSET 2");
assert.equal(s1.statement, "select");
assert.equal(s1.clauses.where, "present");
assert.equal(s1.clauses.limit, "present");
assert.equal(s1.clauses.offset, "present");
assert.equal(s1.unsupported.length, 0);

const s2 = inspectSqlGrammarSkeleton("WITH x AS (SELECT 1) SELECT * FROM x");
assert.equal(s2.clauses.cte, "present");
assert.ok(s2.unsupported.some((u) => u.feature === "cte"));

const s3 = inspectSqlGrammarSkeleton("SELECT TOP 5 id FROM users ORDER BY id");
assert.equal(s3.clauses.top, "present");
assert.ok(s3.unsupported.some((u) => u.feature === "top"));

const s4 = inspectSqlGrammarSkeleton("SELECT id, ROW_NUMBER() OVER (PARTITION BY city ORDER BY id) FROM users");
assert.equal(s4.clauses.windowOver, "present");

const s5 = inspectSqlGrammarSkeleton("SELECT id FROM users ORDER BY id FETCH FIRST 5 ROWS ONLY");
assert.equal(s5.clauses.fetch, "present");
assert.ok(s5.unsupported.some((u) => u.feature === "fetch"));

console.log("sql-grammar-skeleton-smoke ok");
