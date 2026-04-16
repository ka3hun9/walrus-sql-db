import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { fromJs } from "../../types.js";
import { nullTyped } from "../types.js";

function toStr(v: SqlPrimitive): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const REGEXP: SqlScalarFunction = {
  name: "REGEXP",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const pattern = toStr(args[0]?.value ?? null);
    const str = toStr(args[1]?.value ?? null);
    if (pattern === null || str === null) return nullTyped("regex.regexp");
    try {
      const re = new RegExp(pattern, "i");
      return fromJs(re.test(str) as SqlPrimitive, undefined, {}, "regex.regexp");
    } catch {
      return nullTyped("regex.regexp");
    }
  },
};

export const REGEXP_MATCH: SqlScalarFunction = {
  name: "REGEXP_MATCH",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const pattern = toStr(args[0]?.value ?? null);
    const str = toStr(args[1]?.value ?? null);
    if (pattern === null || str === null) return nullTyped("regex.regexp_match");
    try {
      const re = new RegExp(pattern, "i");
      const match = str.match(re);
      if (!match) return nullTyped("regex.regexp_match");
      return fromJs(match[0] as SqlPrimitive, undefined, {}, "regex.regexp_match");
    } catch {
      return nullTyped("regex.regexp_match");
    }
  },
};

export const REGEXP_EXTRACT: SqlScalarFunction = {
  name: "REGEXP_EXTRACT",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const pattern = toStr(args[0]?.value ?? null);
    const str = toStr(args[1]?.value ?? null);
    if (pattern === null || str === null) return nullTyped("regex.regexp_extract");
    try {
      const re = new RegExp(pattern, "i");
      const match = str.match(re);
      if (!match) return nullTyped("regex.regexp_extract");
      const groupIdx = args.length > 2 ? parseInt(String(args[2]?.value ?? "0")) : 0;
      return fromJs(match[groupIdx] ?? null as unknown as SqlPrimitive, undefined, {}, "regex.regexp_extract");
    } catch {
      return nullTyped("regex.regexp_extract");
    }
  },
};

export const REGEXP_REPLACE: SqlScalarFunction = {
  name: "REGEXP_REPLACE",
  minArgs: 3,
  maxArgs: 4,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const pattern = toStr(args[0]?.value ?? null);
    const str = toStr(args[1]?.value ?? null);
    const repl = toStr(args[2]?.value ?? null);
    if (pattern === null || str === null || repl === null) return nullTyped("regex.regexp_replace");
    try {
      const re = new RegExp(pattern, "gi");
      const limit = args.length > 3 ? parseInt(String(args[3]?.value ?? "-1")) : -1;
      if (limit < 0) {
        return fromJs(str.replace(re, repl) as SqlPrimitive, undefined, {}, "regex.regexp_replace");
      }
      let count = 0;
      const result = str.replace(re, (m) => {
        count++;
        return count <= limit ? repl : m;
      });
      return fromJs(result as SqlPrimitive, undefined, {}, "regex.regexp_replace");
    } catch {
      return nullTyped("regex.regexp_replace");
    }
  },
};

export const REGEXP_LIKE: SqlScalarFunction = {
  name: "REGEXP_LIKE",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const str = toStr(args[0]?.value ?? null);
    const pattern = toStr(args[1]?.value ?? null);
    if (str === null || pattern === null) return nullTyped("regex.regexp_like");
    try {
      const matchType = args.length > 2 ? toStr(args[2]?.value ?? null) : null;
      let flags = "i";
      if (matchType) {
        if (matchType.includes("c")) flags = ""; // case-sensitive
        if (matchType.includes("m")) flags += "m"; // multiline
      }
      const re = new RegExp(pattern, flags);
      return fromJs(re.test(str) as SqlPrimitive, undefined, {}, "regex.regexp_like");
    } catch {
      return nullTyped("regex.regexp_like");
    }
  },
};

// ============================================================================
// Primitive implementations
// ============================================================================

function regexpLikePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const str = toStr(args[0]);
  const pattern = toStr(args[1]);
  if (!str || !pattern) return null;
  try {
    return new RegExp(pattern, "i").test(str);
  } catch {
    return null;
  }
}

function regexpReplacePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const pattern = toStr(args[0]);
  const str = toStr(args[1]);
  const repl = toStr(args[2]);
  if (!pattern || !str || !repl) return null;
  try {
    return str.replace(new RegExp(pattern, "gi"), repl);
  } catch {
    return null;
  }
}

export const REGEX_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  REGEXP: { name: "REGEXP", minArgs: 2, maxArgs: 2, evaluate: regexpLikePrim },
  REGEXP_LIKE: { name: "REGEXP_LIKE", minArgs: 2, maxArgs: 3, evaluate: regexpLikePrim },
  REGEXP_REPLACE: { name: "REGEXP_REPLACE", minArgs: 3, maxArgs: 4, evaluate: regexpReplacePrim },
};
