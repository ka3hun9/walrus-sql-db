import type { ExprAst } from "./sql-ast.js";
import {
  convertTypedValue,
  fromJs,
  fromStorage,
  normalizeRuntimeTypeName,
  SqlRuntimeType,
  typedValueComparator,
  typedValueOperators,
  type SqlPrimitive,
  type SqlThreeValuedLogic,
  type SqlTypedValue,
} from "./types.js";
import { evaluateScalarFunction } from "./functions/mod.js";

function maybeWrap(child?: ExprAst): string {
  const rendered = exprAstToSql(child) ?? "";
  if (!child) return rendered;
  if (child.kind === "binary") return `(${rendered})`;
  return rendered;
}

export function exprAstToSql(expr?: ExprAst): string | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case "identifier":
      return expr.name;
    case "literal": {
      const literal = expr.typedValue.value;
      if (literal === null) return "NULL";
      if (typeof literal === "string") return `'${String(literal).replace(/'/g, "''")}'`;
      if (typeof literal === "boolean") return literal ? "TRUE" : "FALSE";
      return String(literal);
    }
    case "function":
      if (expr.name === "LIST") {
        return `(${expr.args.map((a) => exprAstToSql(a) ?? "").join(", ")})`;
      }
      if (expr.name === "RANGE" && expr.args.length >= 2) {
        return `${exprAstToSql(expr.args[0])} AND ${exprAstToSql(expr.args[1])}`;
      }
      if (expr.name === "CAST" && expr.args.length >= 2) {
        // Render CAST using AS syntax: CAST(expr AS type)
        const inner = exprAstToSql(expr.args[0]) ?? "";
        const typeArg = expr.args[1];
        let typeSql: string;
        if (typeArg.kind === "literal" && typeof typeArg.typedValue.value === "string") {
          // SQL type names in CAST are stored as string literals — render without quotes
          typeSql = String(typeArg.typedValue.value);
        } else {
          typeSql = exprAstToSql(typeArg) ?? "";
        }
        return `CAST(${inner} AS ${typeSql})`;
      }
      const filterPart = expr.filter ? ` FILTER (WHERE ${exprAstToSql(expr.filter) ?? ""})` : "";
      return `${expr.name}(${expr.args.map((a) => exprAstToSql(a) ?? "").join(", ")})${filterPart}`;
    case "case": {
      const base = expr.baseExpr ? `${exprAstToSql(expr.baseExpr) ?? ""} ` : "";
      const clauses = expr.whenClauses
        .map((wc) => `WHEN ${exprAstToSql(wc.condition) ?? ""} THEN ${exprAstToSql(wc.result) ?? ""}`)
        .join(" ");
      const elsePart = expr.elseResult ? ` ELSE ${exprAstToSql(expr.elseResult) ?? ""}` : "";
      return `CASE ${base}${clauses}${elsePart} END`;
    }
    case "binary":
      return `${maybeWrap(expr.left)} ${expr.op} ${maybeWrap(expr.right)}`;
    case "unary":
      if (expr.op.toUpperCase() === "NOT") return `NOT (${exprAstToSql(expr.expr)})`;
      return `${expr.op}${exprAstToSql(expr.expr)}`;
    case "exists":
      return `${expr.negated ? "NOT " : ""}EXISTS (${expr.subquerySql})`;
    case "in_subquery":
      return `${exprAstToSql(expr.expr) ?? ""} ${expr.negated ? "NOT IN" : "IN"} (${expr.subquerySql})`;
    case "scalar_subquery":
      return `(${expr.subquerySql})`;
    case "any_subquery":
      return `${exprAstToSql(expr.left) ?? ""} ${expr.op} ${expr.quantifier} (${expr.subquerySql})`;
    case "raw":
      return expr.text;
    default:
      return undefined;
  }
}

function typedNull(sourceContext: string): SqlTypedValue {
  return fromJs(null, undefined, {}, sourceContext);
}

function truthToTyped(truth: SqlThreeValuedLogic, sourceContext: string): SqlTypedValue {
  return fromJs(truth, SqlRuntimeType.BOOLEAN, {}, sourceContext);
}

function tvNot(value: SqlThreeValuedLogic): SqlThreeValuedLogic {
  if (value === null) return null;
  return !value;
}

function tvAnd(a: SqlThreeValuedLogic, b: SqlThreeValuedLogic): SqlThreeValuedLogic {
  if (a === false || b === false) return false;
  if (a === true && b === true) return true;
  return null;
}

function toBooleanTyped(value: SqlTypedValue, sourceContext: string): SqlTypedValue | null {
  try {
    return convertTypedValue(value, SqlRuntimeType.BOOLEAN, {
      mode: "explicit",
      sourceContext,
    });
  } catch {
    return null;
  }
}

function toDoubleTyped(value: SqlTypedValue, sourceContext: string): SqlTypedValue | null {
  try {
    return convertTypedValue(value, SqlRuntimeType.DOUBLE, {
      mode: "explicit",
      sourceContext,
    });
  } catch {
    return null;
  }
}

export function evalExprAstTyped(
  expr: ExprAst,
  resolve: (name: string) => SqlTypedValue | undefined,
): SqlTypedValue {
  switch (expr.kind) {
    case "identifier":
      return resolve(expr.name) ?? typedNull(`expr.identifier:${expr.name}`);
    case "literal":
      return expr.typedValue;
    case "unary": {
      const value = evalExprAstTyped(expr.expr, resolve);
      if (expr.op.toUpperCase() === "NOT") {
        const boolValue = toBooleanTyped(value, "expr.unary.not");
        if (!boolValue) return typedNull("expr.unary.not");
        return typedValueOperators.not(boolValue);
      }
      if (expr.op === "-") {
        const num = toDoubleTyped(value, "expr.unary.minus");
        if (!num) return typedNull("expr.unary.minus");
        return typedValueOperators.sub(fromJs(0, SqlRuntimeType.INT, {}, "expr.unary.zero"), num);
      }
      if (expr.op === "+") {
        const num = toDoubleTyped(value, "expr.unary.plus");
        return num ?? typedNull("expr.unary.plus");
      }
      return typedNull(`expr.unary.${expr.op}`);
    }
    case "binary": {
      const left = evalExprAstTyped(expr.left, resolve);
      const op = expr.op.toUpperCase();

      if (op === "AND" || op === "OR") {
        const right = evalExprAstTyped(expr.right, resolve);
        const l = toBooleanTyped(left, `expr.binary.${op}.left`);
        const r = toBooleanTyped(right, `expr.binary.${op}.right`);
        if (!l || !r) return typedNull(`expr.binary.${op}`);
        return op === "AND" ? typedValueOperators.and(l, r) : typedValueOperators.or(l, r);
      }

      if (op === "BETWEEN" || op === "NOT BETWEEN") {
        if (expr.right.kind === "function" && expr.right.name === "RANGE") {
          const lower = evalExprAstTyped(expr.right.args[0]!, resolve);
          const upper = evalExprAstTyped(expr.right.args[1]!, resolve);
          const ge = typedValueComparator.gte(left, lower);
          const le = typedValueComparator.lte(left, upper);
          const between = tvAnd(ge, le);
          const result = op === "BETWEEN" ? between : tvNot(between);
          return truthToTyped(result, `expr.binary.${op}`);
        }
      }

      if (op === "IN" || op === "NOT IN") {
        if (expr.right.kind === "function" && expr.right.name === "LIST") {
          let hasNull = false;
          for (const arg of expr.right.args) {
            const candidate = evalExprAstTyped(arg, resolve);
            const eq = typedValueComparator.eq(left, candidate);
            if (eq === true) return truthToTyped(op === "IN", `expr.binary.${op}`);
            if (eq === null) hasNull = true;
          }
          if (hasNull) return typedNull(`expr.binary.${op}`);
          return truthToTyped(op !== "IN", `expr.binary.${op}`);
        }
      }

      const right = evalExprAstTyped(expr.right, resolve);
      if (left.value == null || right.value == null) {
        if (op === "IS") return truthToTyped(left.value == null && right.value == null, "expr.binary.IS");
        if (op === "IS NOT") return truthToTyped(!(left.value == null && right.value == null), "expr.binary.IS_NOT");
        return typedNull(`expr.binary.${op}`);
      }

      try {
        if (op === "+") return typedValueOperators.add(left, right);
        if (op === "-") return typedValueOperators.sub(left, right);
        if (op === "*") return typedValueOperators.mul(left, right);
        if (op === "/") return typedValueOperators.div(left, right);
      } catch {
        return typedNull(`expr.binary.${op}`);
      }

      if (op === "%") {
        const l = toDoubleTyped(left, "expr.binary.mod.left");
        const r = toDoubleTyped(right, "expr.binary.mod.right");
        if (!l || !r || l.value == null || r.value == null || r.value === 0) return typedNull("expr.binary.mod");
        return fromJs((l.value as number) % (r.value as number), SqlRuntimeType.DOUBLE, {}, "expr.binary.mod");
      }

      if (op === "=") return truthToTyped(typedValueComparator.eq(left, right), "expr.binary.eq");
      if (op === "!=" || op === "<>") {
        const eq = typedValueComparator.eq(left, right);
        return truthToTyped(eq === null ? null : !eq, "expr.binary.neq");
      }
      if (op === ">") return truthToTyped(typedValueComparator.gt(left, right), "expr.binary.gt");
      if (op === "<") return truthToTyped(typedValueComparator.lt(left, right), "expr.binary.lt");
      if (op === ">=") return truthToTyped(typedValueComparator.gte(left, right), "expr.binary.gte");
      if (op === "<=") return truthToTyped(typedValueComparator.lte(left, right), "expr.binary.lte");
      if (op === "IS") return truthToTyped(left.value === right.value, "expr.binary.is");
      if (op === "IS NOT") return truthToTyped(left.value !== right.value, "expr.binary.is_not");

      if (op === "LIKE" || op === "NOT LIKE") {
        try {
          const leftText = convertTypedValue(left, SqlRuntimeType.TEXT, {
            mode: "explicit",
            sourceContext: "expr.binary.like.left",
          });
          const rightText = convertTypedValue(right, SqlRuntimeType.TEXT, {
            mode: "explicit",
            sourceContext: "expr.binary.like.right",
          });
          if (leftText.value == null || rightText.value == null) return typedNull(`expr.binary.${op}`);
          const pat = String(rightText.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
          const matched = new RegExp(`^${pat}$`, "i").test(String(leftText.value));
          return truthToTyped(op === "LIKE" ? matched : !matched, `expr.binary.${op}`);
        } catch {
          return typedNull(`expr.binary.${op}`);
        }
      }

      return typedNull(`expr.binary.${op}`);
    }
    case "function": {
      const fn = expr.name.toUpperCase();
      const args = expr.args.map((a) => evalExprAstTyped(a, resolve));
      return evaluateScalarFunction(fn, args, { row: {}, resolve });
    }
    case "case": {
      if (expr.baseExpr) {
        // CASE expression WHEN format: compare baseExpr to each WHEN value
        const baseVal = evalExprAstTyped(expr.baseExpr, resolve);
        for (const wc of expr.whenClauses) {
          const whenVal = evalExprAstTyped(wc.condition, resolve);
          const eq = typedValueComparator.eq(baseVal, whenVal);
          if (eq === true) {
            return evalExprAstTyped(wc.result, resolve);
          }
        }
        if (expr.elseResult) {
          return evalExprAstTyped(expr.elseResult, resolve);
        }
        return typedNull("expr.case");
      }
      // CASE WHEN format: evaluate conditions as boolean
      for (const wc of expr.whenClauses) {
        const condVal = evalExprAstTyped(wc.condition, resolve);
        if (condVal.value === true) {
          return evalExprAstTyped(wc.result, resolve);
        }
      }
      if (expr.elseResult) {
        return evalExprAstTyped(expr.elseResult, resolve);
      }
      return typedNull("expr.case");
    }
    case "raw":
      return typedNull("expr.raw");
    default:
      return typedNull("expr.default");
  }
}

export function evalExprAst(expr: ExprAst, resolve: (name: string) => SqlPrimitive | undefined): SqlPrimitive | undefined {
  const typed = evalExprAstTyped(expr, (name) => {
    const value = resolve(name);
    if (value === undefined) return undefined;
    return fromStorage(value ?? null, undefined, {}, `expr.resolve:${name}`);
  });
  return typed.value;
}
