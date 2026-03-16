import { strict as assert } from "node:assert";
import type { ExprAst } from "../src/sql-ast.js";
import { parseSqlToAst } from "../src/parser/index.js";
import { SqlRuntimeType } from "../src/types.js";

function collectLiterals(expr: ExprAst | undefined, out: Array<Extract<ExprAst, { kind: "literal" }>> = []): Array<Extract<ExprAst, { kind: "literal" }>> {
  if (!expr) return out;
  if (expr.kind === "literal") {
    out.push(expr);
    return out;
  }
  if (expr.kind === "unary") return collectLiterals(expr.expr, out);
  if (expr.kind === "binary") {
    collectLiterals(expr.left, out);
    collectLiterals(expr.right, out);
    return out;
  }
  if (expr.kind === "function") {
    for (const arg of expr.args) collectLiterals(arg, out);
  }
  return out;
}

const ast = parseSqlToAst("SELECT id FROM t WHERE id = 1 AND active = true AND name = 'alice' AND deleted_at IS NULL");
assert.equal(ast.kind, "select");
const whereLiterals = collectLiterals(ast.where);
assert.ok(whereLiterals.length >= 4);

for (const literal of whereLiterals) {
  assert.equal(Object.prototype.hasOwnProperty.call(literal, "typedValue"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(literal, "value"), false);
  assert.equal(literal.typedValue.metadata.source, "literal");
}

const oneLiteral = whereLiterals.find((lit) => lit.typedValue.value === 1);
assert.ok(oneLiteral);
assert.equal(oneLiteral!.typedValue.type, SqlRuntimeType.INT);

const trueLiteral = whereLiterals.find((lit) => lit.typedValue.value === true);
assert.ok(trueLiteral);
assert.equal(trueLiteral!.typedValue.type, SqlRuntimeType.BOOLEAN);

const textLiteral = whereLiterals.find((lit) => lit.typedValue.value === "alice");
assert.ok(textLiteral);
assert.equal(textLiteral!.typedValue.type, SqlRuntimeType.TEXT);

const nullLiteral = whereLiterals.find((lit) => lit.typedValue.value === null);
assert.ok(nullLiteral);
assert.equal(nullLiteral!.typedValue.type, SqlRuntimeType.NULL);

const castAst = parseSqlToAst("SELECT CAST(price AS INT) FROM t");
assert.equal(castAst.kind, "select");
const castExpr = castAst.selectItems[0]!.expr;
assert.equal(castExpr.kind, "function");
if (castExpr.kind !== "function") throw new Error("cast expr expected function");
assert.equal(castExpr.name, "CAST");
assert.equal(castExpr.args[1]!.kind, "literal");
if (castExpr.args[1]!.kind !== "literal") throw new Error("cast target expected literal");
assert.equal(castExpr.args[1]!.typedValue.value, "INT");
assert.equal(castExpr.args[1]!.typedValue.metadata.source, "literal");

console.log("ok: K-TVAL-005 AST literal typed values");
