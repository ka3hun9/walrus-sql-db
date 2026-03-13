import { strict as assert } from "node:assert";
import {
  createRowNameResolver,
  evalPredicate3VL,
  resolveIdentifierBinding,
  resolveIdentifierValue,
} from "../src/sql-semantics.js";
import type { ExprAst } from "../src/sql-ast.js";
import { SqlEngineError } from "../src/sql-errors.js";

const row = {
  "users.id": 7,
  id: 7,
  amount: 10,
  "u.city": "SH",
  city: "SH",
};

const b1 = resolveIdentifierBinding(Object.keys(row), "id");
assert.equal(b1.resolved.name, "id");

const b2 = resolveIdentifierBinding(Object.keys(row), "outer.id");
assert.equal(b2.resolved.name, "id");
assert.equal(b2.isOuterRef, true);

assert.equal(resolveIdentifierValue(row, "id"), 7);
assert.equal(resolveIdentifierValue(row, "outer.id"), 7);
assert.equal(resolveIdentifierValue(row, "u.city"), "SH");
assert.equal(resolveIdentifierValue(row, "unknown_col"), undefined);

let ambiguousErr: unknown;
try {
  resolveIdentifierBinding(["u.id", "o.id"], "id");
} catch (e) {
  ambiguousErr = e;
}
assert.ok(ambiguousErr instanceof SqlEngineError);
assert.equal((ambiguousErr as SqlEngineError).code, "SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER");

let unknownErr: unknown;
try {
  resolveIdentifierBinding(["u.id", "o.id"], "price");
} catch (e) {
  unknownErr = e;
}
assert.ok(unknownErr instanceof SqlEngineError);
assert.equal((unknownErr as SqlEngineError).code, "SQL_SEMANTIC_UNKNOWN_IDENTIFIER");

let strictUnknownErr: unknown;
try {
  resolveIdentifierValue({ id: 1 }, "missing", "strict");
} catch (e) {
  strictUnknownErr = e;
}
assert.ok(strictUnknownErr instanceof SqlEngineError);
assert.equal((strictUnknownErr as SqlEngineError).code, "SQL_SEMANTIC_UNKNOWN_IDENTIFIER");

const resolver = createRowNameResolver({ "u.id": 1 });
const resolved = resolver.resolveIdentifier({ name: "u.id" });
assert.equal(resolved.resolved.name, "u.id");

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

let strictPredicateErr: unknown;
try {
  evalPredicate3VL(nullExpr, row, "strict");
} catch (e) {
  strictPredicateErr = e;
}
assert.ok(strictPredicateErr instanceof SqlEngineError);
assert.equal((strictPredicateErr as SqlEngineError).code, "SQL_SEMANTIC_UNKNOWN_IDENTIFIER");

const andExpr: ExprAst = {
  kind: "binary",
  op: "AND",
  left: { kind: "literal", value: true },
  right: { kind: "literal", value: null },
};
assert.equal(evalPredicate3VL(andExpr, row), "UNKNOWN");

console.log("sql-semantics-g3a ok");
