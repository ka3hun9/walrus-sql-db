import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { fromJs } from "../../types.js";
import { nullTyped } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function toStr(v: SqlPrimitive): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toInt(v: SqlPrimitive): number | null {
  if (v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

function regexEscape(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function likeToRegex(pattern: string, escapeChar?: string): RegExp {
  let regexStr = "";
  let i = 0;
  const escape = escapeChar ?? "\\";
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === escape && i + 1 < pattern.length) {
      const next = pattern[i + 1]!;
      regexStr += regexEscape(next);
      i += 2;
      continue;
    }
    if (ch === "%") {
      regexStr += ".*";
    } else if (ch === "_") {
      regexStr += ".";
    } else {
      regexStr += regexEscape(ch);
    }
    i++;
  }
  return new RegExp(`^${regexStr}$`, "i");
}

function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      regexStr += ".*";
    } else if (ch === "?") {
      regexStr += ".";
    } else if (ch === "[") {
      let classStr = "[";
      i++;
      const negated = pattern[i] === "!";
      if (negated) { classStr += "^"; i++; }
      while (i < pattern.length && pattern[i] !== "]") {
        const c = pattern[i]!;
        if (c === "\\" && i + 1 < pattern.length) {
          classStr += `\\${pattern[i + 1]}`;
          i += 2;
          continue;
        }
        if (i + 1 < pattern.length && pattern[i + 1] === "-" && pattern[i + 2] !== "]") {
          classStr += `${c}-${pattern[i + 2]!}`;
          i += 3;
          continue;
        }
        classStr += regexEscape(c);
        i++;
      }
      classStr += "]";
      regexStr += classStr;
    } else {
      regexStr += regexEscape(ch);
    }
    i++;
  }
  return new RegExp(`^${regexStr}$`);
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const SUBSTR: SqlScalarFunction = {
  name: "SUBSTR",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.substr");
    let start = toInt(args[1]?.value ?? null);
    if (start === null) return nullTyped("string.substr");
    const len = args.length > 2 ? (toInt(args[2]?.value ?? null) ?? -1) : -1;
    // SQLite 1-indexed, negative means from end
    if (start > 0) start = start - 1;
    const result = len < 0 ? s.slice(start) : s.slice(start, start + len);
    return fromJs(result as SqlPrimitive, undefined, {}, "string.substr");
  },
};

export const SUBSTRING: SqlScalarFunction = {
  name: "SUBSTRING",
  minArgs: 2,
  maxArgs: 3,
  evaluate: SUBSTR.evaluate, // Same implementation
};

export const LENGTH: SqlScalarFunction = {
  name: "LENGTH",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.length");
    return fromJs(s.length as SqlPrimitive, undefined, {}, "string.length");
  },
};

export const CHAR_LENGTH: SqlScalarFunction = {
  name: "CHAR_LENGTH",
  minArgs: 1,
  maxArgs: 1,
  evaluate: LENGTH.evaluate,
};

export const CHARACTER_LENGTH: SqlScalarFunction = {
  name: "CHARACTER_LENGTH",
  minArgs: 1,
  maxArgs: 1,
  evaluate: LENGTH.evaluate,
};

export const UPPER: SqlScalarFunction = {
  name: "UPPER",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.upper");
    return fromJs(s.toUpperCase() as SqlPrimitive, undefined, {}, "string.upper");
  },
};

export const UCASE: SqlScalarFunction = {
  name: "UCASE",
  minArgs: 1,
  maxArgs: 1,
  evaluate: UPPER.evaluate,
};

export const LOWER: SqlScalarFunction = {
  name: "LOWER",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.lower");
    return fromJs(s.toLowerCase() as SqlPrimitive, undefined, {}, "string.lower");
  },
};

export const LCASE: SqlScalarFunction = {
  name: "LCASE",
  minArgs: 1,
  maxArgs: 1,
  evaluate: LOWER.evaluate,
};

export const TRIM: SqlScalarFunction = {
  name: "TRIM",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.trim");
    const chars = args.length > 1 ? toStr(args[1]?.value ?? null) : null;
    if (chars !== null && chars.length > 0) {
      const re = new RegExp(`^[${chars}]+|[${chars}]+$`, "g");
      return fromJs(s.replace(re, "") as SqlPrimitive, undefined, {}, "string.trim");
    }
    return fromJs(s.trim() as SqlPrimitive, undefined, {}, "string.trim");
  },
};

export const LTRIM: SqlScalarFunction = {
  name: "LTRIM",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.ltrim");
    const chars = args.length > 1 ? toStr(args[1]?.value ?? null) : null;
    if (chars !== null && chars.length > 0) {
      const re = new RegExp(`^[${chars}]+`, "g");
      return fromJs(s.replace(re, "") as SqlPrimitive, undefined, {}, "string.ltrim");
    }
    return fromJs(s.trimStart() as SqlPrimitive, undefined, {}, "string.ltrim");
  },
};

export const RTRIM: SqlScalarFunction = {
  name: "RTRIM",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.rtrim");
    const chars = args.length > 1 ? toStr(args[1]?.value ?? null) : null;
    if (chars !== null && chars.length > 0) {
      const re = new RegExp(`[${chars}]+$`, "g");
      return fromJs(s.replace(re, "") as SqlPrimitive, undefined, {}, "string.rtrim");
    }
    return fromJs(s.trimEnd() as SqlPrimitive, undefined, {}, "string.rtrim");
  },
};

export const REPLACE: SqlScalarFunction = {
  name: "REPLACE",
  minArgs: 3,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const old = toStr(args[1]?.value ?? null);
    const rep = toStr(args[2]?.value ?? null);
    if (s === null || old === null) return nullTyped("string.replace");
    if (rep === null) return nullTyped("string.replace");
    return fromJs(s.split(old).join(rep) as SqlPrimitive, undefined, {}, "string.replace");
  },
};

export const INSTR: SqlScalarFunction = {
  name: "INSTR",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const haystack = toStr(args[0]?.value ?? null);
    const needle = toStr(args[1]?.value ?? null);
    if (haystack === null || needle === null) return nullTyped("string.instr");
    const idx = haystack.toUpperCase().indexOf(needle.toUpperCase());
    return fromJs((idx + 1) as SqlPrimitive, undefined, {}, "string.instr");
  },
};

export const LIKE: SqlScalarFunction = {
  name: "LIKE",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const pattern = toStr(args[1]?.value ?? null);
    if (s === null || pattern === null) return nullTyped("string.like");
    const escape = args.length > 2 ? toStr(args[2]?.value ?? null) : null;
    const re = likeToRegex(pattern, escape ?? undefined);
    return fromJs(re.test(s) as SqlPrimitive, undefined, {}, "string.like");
  },
};

export const GLOB: SqlScalarFunction = {
  name: "GLOB",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const pattern = toStr(args[1]?.value ?? null);
    if (s === null || pattern === null) return nullTyped("string.glob");
    const re = globToRegex(pattern);
    return fromJs(re.test(s) as SqlPrimitive, undefined, {}, "string.glob");
  },
};

export const REVERSE: SqlScalarFunction = {
  name: "REVERSE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("string.reverse");
    return fromJs(s.split("").reverse().join("") as SqlPrimitive, undefined, {}, "string.reverse");
  },
};

export const CHAR: SqlScalarFunction = {
  name: "CHAR",
  minArgs: 0,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const chars = args.map(a => {
      const n = toInt(a.value ?? null);
      return n === null ? null : String.fromCharCode(n);
    });
    return fromJs(chars.filter(c => c !== null).join("") as SqlPrimitive, undefined, {}, "string.char");
  },
};

export const CONCAT: SqlScalarFunction = {
  name: "CONCAT",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const parts = args.map(a => {
      if (a.value === null || a.value === undefined) return "";
      return String(a.value);
    });
    return fromJs(parts.join("") as SqlPrimitive, undefined, {}, "string.concat");
  },
};

export const CONCAT_WS: SqlScalarFunction = {
  name: "CONCAT_WS",
  minArgs: 2,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const sep = toStr(args[0]?.value ?? null);
    if (sep === null) return nullTyped("string.concat_ws");
    const parts = args.slice(1).map(a => {
      if (a.value === null || a.value === undefined) return "";
      return String(a.value);
    });
    return fromJs(parts.join(sep) as SqlPrimitive, undefined, {}, "string.concat_ws");
  },
};

export const LPAD: SqlScalarFunction = {
  name: "LPAD",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const len = toInt(args[1]?.value ?? null);
    if (s === null || len === null) return nullTyped("string.lpad");
    const pad = args.length > 2 ? (toStr(args[2]?.value ?? null) ?? " ") : " ";
    if (s.length >= len) return fromJs(s.slice(0, len) as SqlPrimitive, undefined, {}, "string.lpad");
    const padLen = len - s.length;
    const padStr = pad.repeat(Math.ceil(padLen / pad.length)).slice(0, padLen);
    return fromJs(padStr + s as SqlPrimitive, undefined, {}, "string.lpad");
  },
};

export const RPAD: SqlScalarFunction = {
  name: "RPAD",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const len = toInt(args[1]?.value ?? null);
    if (s === null || len === null) return nullTyped("string.rpad");
    const pad = args.length > 2 ? (toStr(args[2]?.value ?? null) ?? " ") : " ";
    if (s.length >= len) return fromJs(s.slice(0, len) as SqlPrimitive, undefined, {}, "string.rpad");
    const padLen = len - s.length;
    const padStr = pad.repeat(Math.ceil(padLen / pad.length)).slice(0, padLen);
    return fromJs(s + padStr as SqlPrimitive, undefined, {}, "string.rpad");
  },
};

export const REPEAT: SqlScalarFunction = {
  name: "REPEAT",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const n = toInt(args[1]?.value ?? null);
    if (s === null || n === null) return nullTyped("string.repeat");
    return fromJs(s.repeat(Math.max(0, n)) as SqlPrimitive, undefined, {}, "string.repeat");
  },
};

export const LEFT: SqlScalarFunction = {
  name: "LEFT",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const n = toInt(args[1]?.value ?? null);
    if (s === null || n === null) return nullTyped("string.left");
    return fromJs(s.slice(0, n) as SqlPrimitive, undefined, {}, "string.left");
  },
};

export const RIGHT: SqlScalarFunction = {
  name: "RIGHT",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    const n = toInt(args[1]?.value ?? null);
    if (s === null || n === null) return nullTyped("string.right");
    return fromJs(s.slice(-n) as SqlPrimitive, undefined, {}, "string.right");
  },
};

export const QUOTE: SqlScalarFunction = {
  name: "QUOTE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return fromJs("NULL" as SqlPrimitive, undefined, {}, "string.quote");
    return fromJs(`'${s.replace(/'/g, "''")}'` as SqlPrimitive, undefined, {}, "string.quote");
  },
};

// ============================================================================
// Primitive (string-replay) implementations
// ============================================================================

function substrPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  if (s === null) return null;
  let start = toInt(args[1]);
  if (start === null) return null;
  if (start > 0) start = start - 1;
  const len = args.length > 2 ? (toInt(args[2]) ?? -1) : -1;
  return len < 0 ? s.slice(start) : s.slice(start, start + len);
}

function lengthPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  return s === null ? null : s.length;
}

function upperPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  return s === null ? null : s.toUpperCase();
}

function lowerPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  return s === null ? null : s.toLowerCase();
}

function trimPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  if (s === null) return null;
  const chars = args.length > 1 ? toStr(args[1]) : null;
  if (chars !== null && chars.length > 0) {
    const re = new RegExp(`^[${chars}]+|[${chars}]+$`, "g");
    return s.replace(re, "");
  }
  return s.trim();
}

function replacePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  const old = toStr(args[1]);
  const rep = toStr(args[2]);
  if (s === null || old === null || rep === null) return null;
  return s.split(old).join(rep);
}

function likePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  const pattern = toStr(args[1]);
  if (s === null || pattern === null) return null;
  const escape = args.length > 2 ? toStr(args[2]) : null;
  const re = likeToRegex(pattern, escape ?? undefined);
  return re.test(s);
}

function globPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const s = toStr(args[0]);
  const pattern = toStr(args[1]);
  if (s === null || pattern === null) return null;
  return globToRegex(pattern).test(s);
}

function concatPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  return args.map(a => a === null || a === undefined ? "" : String(a)).join("") as SqlPrimitive;
}

function concatWsPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const sep = toStr(args[0]);
  if (sep === null) return null;
  return args.slice(1).map(a => a === null || a === undefined ? "" : String(a)).join(sep) as SqlPrimitive;
}

export const STRING_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  SUBSTR: { name: "SUBSTR", minArgs: 2, maxArgs: 3, evaluate: substrPrim },
  SUBSTRING: { name: "SUBSTRING", minArgs: 2, maxArgs: 3, evaluate: substrPrim },
  LENGTH: { name: "LENGTH", minArgs: 1, maxArgs: 1, evaluate: lengthPrim },
  CHAR_LENGTH: { name: "CHAR_LENGTH", minArgs: 1, maxArgs: 1, evaluate: lengthPrim },
  CHARACTER_LENGTH: { name: "CHARACTER_LENGTH", minArgs: 1, maxArgs: 1, evaluate: lengthPrim },
  UPPER: { name: "UPPER", minArgs: 1, maxArgs: 1, evaluate: upperPrim },
  LOWER: { name: "LOWER", minArgs: 1, maxArgs: 1, evaluate: lowerPrim },
  TRIM: { name: "TRIM", minArgs: 1, maxArgs: 2, evaluate: trimPrim },
  LTRIM: { name: "LTRIM", minArgs: 1, maxArgs: 2, evaluate: trimPrim },
  RTRIM: { name: "RTRIM", minArgs: 1, maxArgs: 2, evaluate: trimPrim },
  REPLACE: { name: "REPLACE", minArgs: 3, maxArgs: 3, evaluate: replacePrim },
  LIKE: { name: "LIKE", minArgs: 2, maxArgs: 3, evaluate: likePrim },
  GLOB: { name: "GLOB", minArgs: 2, maxArgs: 2, evaluate: globPrim },
  CONCAT: { name: "CONCAT", minArgs: 1, maxArgs: -1, evaluate: concatPrim },
  CONCAT_WS: { name: "CONCAT_WS", minArgs: 2, maxArgs: -1, evaluate: concatWsPrim },
};
