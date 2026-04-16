import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { fromJs } from "../../types.js";

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const COALESCE: SqlScalarFunction = {
  name: "COALESCE",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[]): SqlTypedValue {
    for (const arg of args) {
      if (arg.value !== null && arg.value !== undefined) {
        return arg;
      }
    }
    return args.length > 0 ? args[args.length - 1]! : fromJs(null, undefined, {}, "coalesce");
  },
};

export const NULLIF: SqlScalarFunction = {
  name: "NULLIF",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[]): SqlTypedValue {
    const a = args[0];
    const b = args[1];
    if (!a || !b) return a ?? fromJs(null, undefined, {}, "nullif");
    if (a.value == null || b.value == null) return a;
    const aStr = String(a.value);
    const bStr = String(b.value);
    return aStr === bStr ? fromJs(null, undefined, {}, "nullif") : a;
  },
};

export const IFNULL: SqlScalarFunction = {
  name: "IFNULL",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[]): SqlTypedValue {
    const a = args[0];
    const b = args[1];
    if (a && a.value !== null && a.value !== undefined) return a;
    return b ?? fromJs(null, undefined, {}, "ifnull");
  },
};

export const IIF: SqlScalarFunction = {
  name: "IIF",
  minArgs: 3,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[]): SqlTypedValue {
    const cond = args[0];
    const isTrue = cond.value === true || (typeof cond.value === "number" && cond.value !== 0);
    return isTrue ? (args[1] ?? fromJs(null, undefined, {}, "iif")) : (args[2] ?? fromJs(null, undefined, {}, "iif"));
  },
};

// ============================================================================
// Primitive (string-replay path) implementations
// ============================================================================

function coalescePrimitive(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  for (const arg of args) {
    if (arg !== null && arg !== undefined) return arg;
  }
  return null;
}

function nullifPrimitive(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const a = args[0];
  const b = args[1];
  if (a == null || b == null) return a ?? null;
  return String(a) === String(b) ? null : a;
}

function ifnullPrimitive(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const a = args[0];
  if (a !== null && a !== undefined) return a;
  return args[1] ?? null;
}

function iifPrimitive(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const cond = args[0];
  const isTrue = cond === true || (typeof cond === "number" && cond !== 0);
  return isTrue ? (args[1] ?? null) : (args[2] ?? null);
}

// ============================================================================
// Registry entries for primitive path
// ============================================================================

export const CONDITIONAL_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  COALESCE: { name: "COALESCE", minArgs: 1, maxArgs: -1, evaluate: coalescePrimitive },
  NULLIF: { name: "NULLIF", minArgs: 2, maxArgs: 2, evaluate: nullifPrimitive },
  IFNULL: { name: "IFNULL", minArgs: 2, maxArgs: 2, evaluate: ifnullPrimitive },
  IIF: { name: "IIF", minArgs: 3, maxArgs: 3, evaluate: iifPrimitive },
};
