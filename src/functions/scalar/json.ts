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

function jsonGetPath(path: string): (string | number)[] {
  // Parse JSON path like '$.a.b[0].c' or '$.a.b[2]'
  const parts: (string | number)[] = [];
  const normalized = path.replace(/^\$\.?/, "");
  if (!normalized) return parts;
  const tokens = normalized.match(/[\[\]|[^.\[\]]+/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === ".") { i++; continue; }
    if (/^\d+$/.test(t)) {
      parts.push(parseInt(t));
    } else {
      parts.push(t);
    }
    i++;
  }
  return parts;
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const JSON_BODY: SqlScalarFunction = {
  name: "JSON",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (v === null || v === undefined) return nullTyped("json.json");
    const s = String(v);
    try {
      // eslint-disable-next-line no-restricted-globals
      JSON.parse(s);
      return fromJs(s as SqlPrimitive, undefined, {}, "json.json");
    } catch {
      return nullTyped("json.json");
    }
  },
};

export const JSON_EXTRACT: SqlScalarFunction = {
  name: "JSON_EXTRACT",
  minArgs: 2,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_extract");
    try {
      const obj = JSON.parse(jsonStr);
      // Collect all path arguments
      const paths = args.slice(1).map(a => String(a.value ?? ""));
      if (paths.length === 1) {
        const parts = jsonGetPath(paths[0]);
        let cur: unknown = obj;
        for (const p of parts) {
          if (cur === null || cur === undefined) { cur = null; break; }
          cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
        }
        if (cur === undefined) return nullTyped("json.json_extract");
        if (cur === null) return fromJs(null as unknown as SqlPrimitive, undefined, {}, "json.json_extract");
        return fromJs(JSON.stringify(cur) as SqlPrimitive, undefined, {}, "json.json_extract");
      }
      // Multiple paths - return array
      const results = paths.map(path => {
        let cur: unknown = obj;
        for (const p of jsonGetPath(path)) {
          if (cur === null || cur === undefined) { cur = null; break; }
          cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
        }
        return cur;
      });
      return fromJs(JSON.stringify(results) as SqlPrimitive, undefined, {}, "json.json_extract");
    } catch {
      return nullTyped("json.json_extract");
    }
  },
};

export const JSON_OBJECT: SqlScalarFunction = {
  name: "JSON_OBJECT",
  minArgs: 0,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    if (args.length % 2 !== 0) return nullTyped("json.json_object");
    try {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = String(args[i]?.value ?? "");
        const val = args[i + 1]?.value ?? null;
        obj[key] = val;
      }
      return fromJs(JSON.stringify(obj) as SqlPrimitive, undefined, {}, "json.json_object");
    } catch {
      return nullTyped("json.json_object");
    }
  },
};

export const JSON_ARRAY: SqlScalarFunction = {
  name: "JSON_ARRAY",
  minArgs: 0,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    try {
      const arr = args.map(a => a.value ?? null);
      return fromJs(JSON.stringify(arr) as SqlPrimitive, undefined, {}, "json.json_array");
    } catch {
      return nullTyped("json.json_array");
    }
  },
};

export const JSON_TYPE: SqlScalarFunction = {
  name: "JSON_TYPE",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_type");
    try {
      const obj = JSON.parse(jsonStr);
      const path = args.length > 1 ? String(args[1]?.value ?? "$") : "$";
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) {
          return fromJs("null" as SqlPrimitive, undefined, {}, "json.json_type");
        }
        cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
      }
      if (cur === undefined) return fromJs("null" as SqlPrimitive, undefined, {}, "json.json_type");
      if (cur === null) return fromJs("null" as SqlPrimitive, undefined, {}, "json.json_type");
      if (typeof cur === "string") return fromJs("text" as SqlPrimitive, undefined, {}, "json.json_type");
      if (typeof cur === "number") return fromJs("integer" as SqlPrimitive, undefined, {}, "json.json_type");
      if (typeof cur === "boolean") return fromJs("true" as SqlPrimitive, undefined, {}, "json.json_type");
      if (Array.isArray(cur)) return fromJs("array" as SqlPrimitive, undefined, {}, "json.json_type");
      return fromJs("object" as SqlPrimitive, undefined, {}, "json.json_type");
    } catch {
      return nullTyped("json.json_type");
    }
  },
};

export const JSON_VALID: SqlScalarFunction = {
  name: "JSON_VALID",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (v === null || v === undefined) return fromJs(0 as SqlPrimitive, undefined, {}, "json.json_valid");
    try {
      JSON.parse(String(v));
      return fromJs(1 as SqlPrimitive, undefined, {}, "json.json_valid");
    } catch {
      return fromJs(0 as SqlPrimitive, undefined, {}, "json.json_valid");
    }
  },
};

export const JSON_LENGTH: SqlScalarFunction = {
  name: "JSON_LENGTH",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_length");
    try {
      const obj = JSON.parse(jsonStr);
      const path = args.length > 1 ? String(args[1]?.value ?? "$") : "$";
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) { cur = null; break; }
        cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
      }
      if (cur === null || cur === undefined) return nullTyped("json.json_length");
      if (Array.isArray(cur)) return fromJs(cur.length as SqlPrimitive, undefined, {}, "json.json_length");
      if (typeof cur === "object") return fromJs(Object.keys(cur as object).length as SqlPrimitive, undefined, {}, "json.json_length");
      return fromJs(1 as SqlPrimitive, undefined, {}, "json.json_length");
    } catch {
      return nullTyped("json.json_length");
    }
  },
};

export const JSON_INSERT: SqlScalarFunction = {
  name: "JSON_INSERT",
  minArgs: 3,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_insert");
    try {
      const obj = JSON.parse(jsonStr);
      for (let i = 1; i < args.length - 1; i += 2) {
        const path = String(args[i]?.value ?? "$");
        const value = args[i + 1]?.value ?? null;
        const parts = jsonGetPath(path);
        let cur: Record<string, unknown> | unknown[] = obj;
        for (let j = 0; j < parts.length - 1; j++) {
          const p = parts[j]!;
          const next = parts[j + 1]!;
          if (Array.isArray(cur)) {
            if (typeof p === "number" && cur[p] !== undefined) {
              cur = cur[p] as Record<string, unknown> | unknown[];
            } else {
              cur = [] as unknown[];
              (Array.isArray(cur) ? [] : obj)[typeof p === "number" ? p : p] = cur;
            }
          }
        }
      }
      return fromJs(JSON.stringify(obj) as SqlPrimitive, undefined, {}, "json.json_insert");
    } catch {
      return nullTyped("json.json_insert");
    }
  },
};

export const JSON_SET: SqlScalarFunction = {
  name: "JSON_SET",
  minArgs: 3,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_set");
    try {
      const obj = JSON.parse(jsonStr);
      for (let i = 1; i < args.length - 1; i += 2) {
        const path = String(args[i]?.value ?? "$");
        const value = args[i + 1]?.value ?? null;
        const parts = jsonGetPath(path);
        let cur: Record<string, unknown> | unknown[] = obj;
        for (let j = 0; j < parts.length - 1; j++) {
          const p = parts[j]!;
          const nextKey = parts[j + 1]!;
          if (Array.isArray(cur) && typeof p === "number") {
            if (cur[p] === undefined) cur[p] = typeof nextKey === "number" ? [] : {};
            cur = cur[p] as Record<string, unknown> | unknown[];
          } else if (!Array.isArray(cur) && typeof p === "string") {
            if ((cur as Record<string, unknown>)[p] === undefined) (cur as Record<string, unknown>)[p] = typeof nextKey === "number" ? [] : {};
            cur = (cur as Record<string, unknown>)[p] as Record<string, unknown> | unknown[];
          }
        }
        if (Array.isArray(cur) && typeof parts[parts.length - 1] === "number") {
          (cur as unknown[])[parts[parts.length - 1] as number] = value;
        } else if (!Array.isArray(cur)) {
          (cur as Record<string, unknown>)[parts[parts.length - 1] as string] = value;
        }
      }
      return fromJs(JSON.stringify(obj) as SqlPrimitive, undefined, {}, "json.json_set");
    } catch {
      return nullTyped("json.json_set");
    }
  },
};

export const JSON_REMOVE: SqlScalarFunction = {
  name: "JSON_REMOVE",
  minArgs: 2,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_remove");
    try {
      const obj = JSON.parse(jsonStr);
      for (let i = 1; i < args.length; i++) {
        const path = String(args[i]?.value ?? "");
        const parts = jsonGetPath(path);
        let cur: Record<string, unknown> | unknown[] = obj;
        for (let j = 0; j < parts.length - 1; j++) {
          const p = parts[j]!;
          if (Array.isArray(cur) && typeof p === "number") {
            cur = cur[p] as Record<string, unknown> | unknown[];
          } else if (!Array.isArray(cur) && typeof p === "string") {
            cur = (cur as Record<string, unknown>)[p] as Record<string, unknown> | unknown[];
          }
        }
        const last = parts[parts.length - 1];
        if (Array.isArray(cur) && typeof last === "number") {
          cur.splice(last, 1);
        } else if (!Array.isArray(cur) && typeof last === "string") {
          delete (cur as Record<string, unknown>)[last];
        }
      }
      return fromJs(JSON.stringify(obj) as SqlPrimitive, undefined, {}, "json.json_remove");
    } catch {
      return nullTyped("json.json_remove");
    }
  },
};

// ============================================================================
// Primitive implementations
// ============================================================================

function jsonExtractPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
    }
    if (cur === undefined) return null;
    return JSON.stringify(cur);
  } catch {
    return null;
  }
}

function jsonValidPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const v = args[0];
  if (v === null || v === undefined) return 0;
  try {
    JSON.parse(String(v));
    return 1;
  } catch {
    return 0;
  }
}

function jsonTypePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return "null";
      cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
    }
    if (cur === undefined) return "null";
    if (cur === null) return "null";
    if (typeof cur === "string") return "text";
    if (typeof cur === "number") return "integer";
    if (typeof cur === "boolean") return "true";
    if (Array.isArray(cur)) return "array";
    return "object";
  } catch {
    return null;
  }
}

function jsonLengthPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      cur = Array.isArray(cur) ? (typeof p === "number" ? cur[p] : undefined) : (typeof p === "string" ? (cur as Record<string, unknown>)[p] : undefined);
    }
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) return cur.length;
    if (typeof cur === "object") return Object.keys(cur as object).length;
    return 1;
  } catch {
    return null;
  }
}

export const JSON_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  JSON_EXTRACT: { name: "JSON_EXTRACT", minArgs: 2, maxArgs: -1, evaluate: jsonExtractPrim },
  JSON_VALID: { name: "JSON_VALID", minArgs: 1, maxArgs: 1, evaluate: jsonValidPrim },
  JSON_TYPE: { name: "JSON_TYPE", minArgs: 2, maxArgs: 3, evaluate: jsonTypePrim },
  JSON_LENGTH: { name: "JSON_LENGTH", minArgs: 1, maxArgs: 2, evaluate: jsonLengthPrim },
};
