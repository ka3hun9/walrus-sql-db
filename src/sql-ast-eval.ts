import type { ExprAst } from "./sql-ast.js";
import type { SqlPrimitive } from "./types.js";

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
    case "literal":
      if (expr.value === null) return "NULL";
      if (typeof expr.value === "string") return `'${String(expr.value).replace(/'/g, "''")}'`;
      if (typeof expr.value === "boolean") return expr.value ? "TRUE" : "FALSE";
      return String(expr.value);
    case "function":
      if (expr.name === "LIST") {
        return `(${expr.args.map((a) => exprAstToSql(a) ?? "").join(", ")})`;
      }
      if (expr.name === "RANGE" && expr.args.length >= 2) {
        return `${exprAstToSql(expr.args[0])} AND ${exprAstToSql(expr.args[1])}`;
      }
      return `${expr.name}(${expr.args.map((a) => exprAstToSql(a) ?? "").join(", ")})`;
    case "binary":
      return `${maybeWrap(expr.left)} ${expr.op} ${maybeWrap(expr.right)}`;
    case "unary":
      if (expr.op.toUpperCase() === "NOT") return `NOT (${exprAstToSql(expr.expr)})`;
      return `${expr.op}${exprAstToSql(expr.expr)}`;
    case "raw":
      return expr.text;
    default:
      return undefined;
  }
}

export function evalExprAst(expr: ExprAst, resolve: (name: string) => SqlPrimitive | undefined): SqlPrimitive | undefined {
  switch (expr.kind) {
    case "identifier":
      return resolve(expr.name);
    case "literal":
      return expr.value;
    case "unary": {
      const v = evalExprAst(expr.expr, resolve);
      if (expr.op.toUpperCase() === "NOT") {
        if (v == null) return null;
        return !Boolean(v);
      }
      if (expr.op === "-") {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? -n : null;
      }
      if (expr.op === "+") {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }
    case "binary": {
      const l = evalExprAst(expr.left, resolve);
      const r = evalExprAst(expr.right, resolve);
      const op = expr.op.toUpperCase();

      if (op === "AND") {
        if (l === false || r === false) return false;
        if (l == null || r == null) return null;
        return Boolean(l) && Boolean(r);
      }
      if (op === "OR") {
        if (l === true || r === true) return true;
        if (l == null || r == null) return null;
        return Boolean(l) || Boolean(r);
      }

      if (l == null || r == null) {
        if (op === "IS") return l == null && r == null;
        if (op === "IS NOT") return !(l == null && r == null);
        return null;
      }

      if (op === "+") return Number(l) + Number(r);
      if (op === "-") return Number(l) - Number(r);
      if (op === "*") return Number(l) * Number(r);
      if (op === "/") return Number(r) === 0 ? null : Number(l) / Number(r);
      if (op === "%") return Number(r) === 0 ? null : Number(l) % Number(r);

      if (op === "=") return String(l) === String(r);
      if (op === "!=" || op === "<>") return String(l) !== String(r);
      if (op === ">") return Number(l) > Number(r);
      if (op === "<") return Number(l) < Number(r);
      if (op === ">=") return Number(l) >= Number(r);
      if (op === "<=") return Number(l) <= Number(r);
      if (op === "IS") return String(l) === String(r);
      if (op === "IS NOT") return String(l) !== String(r);

      if (op === "BETWEEN" || op === "NOT BETWEEN") {
        if (expr.right.kind === "function" && expr.right.name === "RANGE") {
          const a = evalExprAst(expr.right.args[0]!, resolve);
          const b = evalExprAst(expr.right.args[1]!, resolve);
          if (a == null || b == null) return null;
          const ok = Number(l) >= Number(a) && Number(l) <= Number(b);
          return op === "BETWEEN" ? ok : !ok;
        }
      }

      if (op === "IN" || op === "NOT IN") {
        if (expr.right.kind === "function" && expr.right.name === "LIST") {
          const vals = expr.right.args.map((a) => evalExprAst(a, resolve));
          const has = vals.some((v) => String(v) === String(l));
          return op === "IN" ? has : !has;
        }
      }

      if (op === "LIKE" || op === "NOT LIKE") {
        const pat = String(r).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
        const m = new RegExp(`^${pat}$`, "i").test(String(l));
        return op === "LIKE" ? m : !m;
      }

      return null;
    }
    case "function": {
      const fn = expr.name.toUpperCase();
      const args = expr.args.map((a) => evalExprAst(a, resolve));

      if (fn === "COALESCE") {
        for (const v of args) {
          if (v !== null && v !== undefined) return v;
        }
        return null;
      }

      if (fn === "NULLIF") {
        const a = args[0];
        const b = args[1];
        if (a == null || b == null) return a ?? null;
        return String(a) === String(b) ? null : a;
      }

      return null;
    }
    case "raw":
      return null;
    default:
      return null;
  }
}
