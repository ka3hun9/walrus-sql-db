import { strict as assert } from "node:assert";
import type { ExprAst } from "../src/sql-ast.js";
import { evalExprAst, evalExprAstTyped } from "../src/sql-ast-eval.js";
import { SqlRuntimeType, fromLiteral } from "../src/types.js";

const addExpr: ExprAst = {
  kind: "binary",
  op: "+",
  left: { kind: "literal", typedValue: fromLiteral(1, SqlRuntimeType.INT) },
  right: { kind: "literal", typedValue: fromLiteral(2, SqlRuntimeType.INT) },
};
const addTyped = evalExprAstTyped(addExpr, () => undefined);
assert.equal(addTyped.type, SqlRuntimeType.INT);
assert.equal(addTyped.value, 3);
assert.equal(addTyped.metadata.source, "computed");
assert.equal(evalExprAst(addExpr, () => undefined), 3);

const andExpr: ExprAst = {
  kind: "binary",
  op: "AND",
  left: { kind: "literal", typedValue: fromLiteral(true, SqlRuntimeType.BOOLEAN) },
  right: { kind: "literal", typedValue: fromLiteral(null, SqlRuntimeType.BOOLEAN) },
};
const andTyped = evalExprAstTyped(andExpr, () => undefined);
assert.equal(andTyped.type, SqlRuntimeType.BOOLEAN);
assert.equal(andTyped.value, null);

const cmpExpr: ExprAst = {
  kind: "binary",
  op: ">",
  left: { kind: "literal", typedValue: fromLiteral(5, SqlRuntimeType.INT) },
  right: { kind: "literal", typedValue: fromLiteral(3, SqlRuntimeType.INT) },
};
const cmpTyped = evalExprAstTyped(cmpExpr, () => undefined);
assert.equal(cmpTyped.type, SqlRuntimeType.BOOLEAN);
assert.equal(cmpTyped.value, true);

const castExpr: ExprAst = {
  kind: "function",
  name: "CAST",
  args: [
    { kind: "literal", typedValue: fromLiteral("123", SqlRuntimeType.TEXT) },
    { kind: "literal", typedValue: fromLiteral("INT", SqlRuntimeType.TEXT) },
  ],
};
const castTyped = evalExprAstTyped(castExpr, () => undefined);
assert.equal(castTyped.type, SqlRuntimeType.INT);
assert.equal(castTyped.value, 123);

console.log("ok: K-TVAL-008 expression evaluator typed values");
