import { strict as assert } from "node:assert";
import { evalPredicate3VL, resolveIdentifierValue } from "../src/sql-semantics.js";
import type { ExprAst } from "../src/sql-ast.js";
import { SqlEngineError } from "../src/sql-errors.js";

const row = {
  "users.id": 7,
  "orders.id": 9,
  id: 7,
  amount: 10,
  "u.city": "SH",
  city: "SH",
};

assert.equal(resolveIdentifierValue(row, "id"), 7);
assert.equal(resolveIdentifierValue(row, "outer.id"), 7);
assert.equal(resolveIdentifierValue(row, "u.city"), "SH");

let ambiguousErr: unknown;
try {
  resolveIdentifierValue({ "u.id": 1, "o.id": 2 }, "id");
} catch (e) {
  ambiguousErr = e;
}
assert.ok(ambiguousErr instanceof SqlEngineError);
assert.equal((ambiguousErr as SqlEngineError).code, "SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER");

const gtExpr: ExprAst = {
  kind: "binary",
  op: ">",
  left: { kind: "identifier", name: "amount" },
  right: { kind: "literal", value: 3 },
};
assert.equal(evalPredicate3VL(gtExpr, row), "TRUE");

const nullExpr: ExprAst = {
  kind: "binary",
  op: "=",
  left: { kind: "identifier", name: "missing_col" },
  right: { kind: "literal", value: 1 },
};
assert.equal(evalPredicate3VL(nullExpr, row), "UNKNOWN");

const andExpr: ExprAst = {
  kind: "binary",
  op: "AND",
  left: { kind: "literal", value: true },
  right: { kind: "literal", value: null },
};
assert.equal(evalPredicate3VL(andExpr, row), "UNKNOWN");

console.log("sql-semantics-g3a ok");
