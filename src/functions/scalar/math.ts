import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { fromJs } from "../../types.js";
import { nullTyped } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function toNumber(v: SqlPrimitive): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: SqlPrimitive): number | null {
  if (v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

function makeMathFn(fn: (n: number) => number, name: string) {
  return (args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue => {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped(`math.${name}`);
    return fromJs(fn(n) as SqlPrimitive, undefined, {}, `math.${name}`);
  };
}

function makeMathFn2(fn: (a: number, b: number) => number, name: string) {
  return (args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue => {
    const a = toNumber(args[0]?.value ?? null);
    const b = toNumber(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped(`math.${name}`);
    return fromJs(fn(a, b) as SqlPrimitive, undefined, {}, `math.${name}`);
  };
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const ABS: SqlScalarFunction = {
  name: "ABS",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.abs");
    return fromJs(Math.abs(n) as SqlPrimitive, undefined, {}, "math.abs");
  },
};

export const CEIL: SqlScalarFunction = {
  name: "CEIL",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.ceil, "ceil"),
};

export const CEILING: SqlScalarFunction = {
  name: "CEILING",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.ceil, "ceiling"),
};

export const FLOOR: SqlScalarFunction = {
  name: "FLOOR",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.floor, "floor"),
};

export const ROUND: SqlScalarFunction = {
  name: "ROUND",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.round");
    const d = args.length > 1 ? (toInt(args[1]?.value ?? null) ?? 0) : 0;
    const factor = Math.pow(10, d);
    const result = Math.round(n * factor) / factor;
    return fromJs(result as SqlPrimitive, undefined, {}, "math.round");
  },
};

export const TRUNC: SqlScalarFunction = {
  name: "TRUNC",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.trunc");
    const d = args.length > 1 ? (toInt(args[1]?.value ?? null) ?? 0) : 0;
    const factor = Math.pow(10, d);
    const result = n >= 0 ? Math.floor(n * factor) / factor : Math.ceil(n * factor) / factor;
    return fromJs(result as SqlPrimitive, undefined, {}, "math.trunc");
  },
};

export const SQRT: SqlScalarFunction = {
  name: "SQRT",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.sqrt, "sqrt"),
};

export const POW: SqlScalarFunction = {
  name: "POW",
  minArgs: 2,
  maxArgs: 2,
  evaluate: makeMathFn2(Math.pow, "pow"),
};

export const POWER: SqlScalarFunction = {
  name: "POWER",
  minArgs: 2,
  maxArgs: 2,
  evaluate: makeMathFn2(Math.pow, "power"),
};

export const MOD: SqlScalarFunction = {
  name: "MOD",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toNumber(args[0]?.value ?? null);
    const b = toNumber(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.mod");
    if (b === 0) return nullTyped("math.mod");
    return fromJs((a % b) as SqlPrimitive, undefined, {}, "math.mod");
  },
};

export const SIGN: SqlScalarFunction = {
  name: "SIGN",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.sign");
    return fromJs(Math.sign(n) as SqlPrimitive, undefined, {}, "math.sign");
  },
};

export const EXP: SqlScalarFunction = {
  name: "EXP",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.exp, "exp"),
};

export const LN: SqlScalarFunction = {
  name: "LN",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.ln");
    if (n <= 0) return nullTyped("math.ln");
    return fromJs(Math.log(n) as SqlPrimitive, undefined, {}, "math.ln");
  },
};

export const LOG: SqlScalarFunction = {
  name: "LOG",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toNumber(args[0]?.value ?? null);
    const b = args.length > 1 ? toNumber(args[1]?.value ?? null) : null;
    if (a === null) return nullTyped("math.log");
    if (b !== null) {
      // LOG(x, base)
      if (a <= 0 || b <= 0 || b === 1) return nullTyped("math.log");
      return fromJs(Math.log(a) / Math.log(b) as SqlPrimitive, undefined, {}, "math.log");
    }
    // LOG(x) = natural log
    if (a <= 0) return nullTyped("math.log");
    return fromJs(Math.log(a) as SqlPrimitive, undefined, {}, "math.log");
  },
};

export const LOG2: SqlScalarFunction = {
  name: "LOG2",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.log2");
    if (n <= 0) return nullTyped("math.log2");
    return fromJs(Math.log2(n) as SqlPrimitive, undefined, {}, "math.log2");
  },
};

export const LOG10: SqlScalarFunction = {
  name: "LOG10",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.log10");
    if (n <= 0) return nullTyped("math.log10");
    return fromJs(Math.log10(n) as SqlPrimitive, undefined, {}, "math.log10");
  },
};

export const SIN: SqlScalarFunction = {
  name: "SIN",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.sin, "sin"),
};

export const COS: SqlScalarFunction = {
  name: "COS",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.cos, "cos"),
};

export const TAN: SqlScalarFunction = {
  name: "TAN",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.tan, "tan"),
};

export const ASIN: SqlScalarFunction = {
  name: "ASIN",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.asin, "asin"),
};

export const ACOS: SqlScalarFunction = {
  name: "ACOS",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.acos, "acos"),
};

export const ATAN: SqlScalarFunction = {
  name: "ATAN",
  minArgs: 1,
  maxArgs: 1,
  evaluate: makeMathFn(Math.atan, "atan"),
};

export const ATAN2: SqlScalarFunction = {
  name: "ATAN2",
  minArgs: 2,
  maxArgs: 2,
  evaluate: makeMathFn2(Math.atan2, "atan2"),
};

export const DEGREES: SqlScalarFunction = {
  name: "DEGREES",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.degrees");
    return fromJs((n * 180 / Math.PI) as SqlPrimitive, undefined, {}, "math.degrees");
  },
};

export const RADIANS: SqlScalarFunction = {
  name: "RADIANS",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.radians");
    return fromJs((n * Math.PI / 180) as SqlPrimitive, undefined, {}, "math.radians");
  },
};

export const PI: SqlScalarFunction = {
  name: "PI",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(Math.PI as SqlPrimitive, undefined, {}, "math.pi");
  },
};

export const RANDOM: SqlScalarFunction = {
  name: "RANDOM",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(Math.floor(Math.random() * 2147483648 - 1073741824) as SqlPrimitive, undefined, {}, "math.random");
  },
};

export const SQUARE: SqlScalarFunction = {
  name: "SQUARE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const n = toNumber(args[0]?.value ?? null);
    if (n === null) return nullTyped("math.square");
    return fromJs((n * n) as SqlPrimitive, undefined, {}, "math.square");
  },
};

export const BITAND: SqlScalarFunction = {
  name: "BITAND",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    const b = toInt(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.bitand");
    return fromJs((a & b) as SqlPrimitive, undefined, {}, "math.bitand");
  },
};

export const BITOR: SqlScalarFunction = {
  name: "BITOR",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    const b = toInt(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.bitor");
    return fromJs((a | b) as SqlPrimitive, undefined, {}, "math.bitor");
  },
};

export const BITXOR: SqlScalarFunction = {
  name: "BITXOR",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    const b = toInt(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.bitxor");
    return fromJs((a ^ b) as SqlPrimitive, undefined, {}, "math.bitxor");
  },
};

export const BITNOT: SqlScalarFunction = {
  name: "BITNOT",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    if (a === null) return nullTyped("math.bitnot");
    return fromJs((~a) as SqlPrimitive, undefined, {}, "math.bitnot");
  },
};

export const LSHIFT: SqlScalarFunction = {
  name: "LSHIFT",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    const b = toInt(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.lshift");
    return fromJs((a << b) as SqlPrimitive, undefined, {}, "math.lshift");
  },
};

export const RSHIFT: SqlScalarFunction = {
  name: "RSHIFT",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const a = toInt(args[0]?.value ?? null);
    const b = toInt(args[1]?.value ?? null);
    if (a === null || b === null) return nullTyped("math.rshift");
    return fromJs((a >> b) as SqlPrimitive, undefined, {}, "math.rshift");
  },
};

// ============================================================================
// Primitive (string-replay) implementations
// ============================================================================

function absPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const n = toNumber(args[0]);
  return n === null ? null : Math.abs(n) as SqlPrimitive;
}

function roundPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const n = toNumber(args[0]);
  if (n === null) return null;
  const d = args.length > 1 ? (toInt(args[1]) ?? 0) : 0;
  const factor = Math.pow(10, d);
  return Math.round(n * factor) / factor as SqlPrimitive;
}

function sqrtPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const n = toNumber(args[0]);
  return n === null || n < 0 ? null : Math.sqrt(n) as SqlPrimitive;
}

function powPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const a = toNumber(args[0]);
  const b = toNumber(args[1]);
  if (a === null || b === null) return null;
  return Math.pow(a, b) as SqlPrimitive;
}

function modPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const a = toNumber(args[0]);
  const b = toNumber(args[1]);
  if (a === null || b === null || b === 0) return null;
  return (a % b) as SqlPrimitive;
}

function randomPrim(_args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  return Math.floor(Math.random() * 2147483648 - 1073741824) as SqlPrimitive;
}

export const MATH_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  ABS: { name: "ABS", minArgs: 1, maxArgs: 1, evaluate: absPrim },
  CEIL: { name: "CEIL", minArgs: 1, maxArgs: 1, evaluate: absPrim },
  CEILING: { name: "CEILING", minArgs: 1, maxArgs: 1, evaluate: absPrim },
  FLOOR: { name: "FLOOR", minArgs: 1, maxArgs: 1, evaluate: absPrim },
  ROUND: { name: "ROUND", minArgs: 1, maxArgs: 2, evaluate: roundPrim },
  TRUNC: { name: "TRUNC", minArgs: 1, maxArgs: 2, evaluate: roundPrim },
  SQRT: { name: "SQRT", minArgs: 1, maxArgs: 1, evaluate: sqrtPrim },
  POW: { name: "POW", minArgs: 2, maxArgs: 2, evaluate: powPrim },
  POWER: { name: "POWER", minArgs: 2, maxArgs: 2, evaluate: powPrim },
  MOD: { name: "MOD", minArgs: 2, maxArgs: 2, evaluate: modPrim },
  RANDOM: { name: "RANDOM", minArgs: 0, maxArgs: 0, evaluate: randomPrim },
};
