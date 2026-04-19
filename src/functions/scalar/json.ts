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
  // Match: bracket chars [ or ]  OR  one or more non-bracket, non-dot chars
  const tokens = normalized.match(/[\[\]]|[^.\\[\]]+/g) ?? [];
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
        // Traverse to parent of target path
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
        // INSERT only if path doesn't already exist
        const lastPart = parts[parts.length - 1]!;
        if (Array.isArray(cur) && typeof lastPart === "number") {
          if (cur[lastPart] === undefined) cur[lastPart] = value;
        } else if (!Array.isArray(cur) && typeof lastPart === "string") {
          if ((cur as Record<string, unknown>)[lastPart] === undefined) (cur as Record<string, unknown>)[lastPart] = value;
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
// SQL:2016 JSON functions
// ============================================================================

// JSON_EXISTS(json, path [, on_error]) - tests whether a JSON path exists
export const JSON_EXISTS: SqlScalarFunction = {
  name: "JSON_EXISTS",
  minArgs: 2,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_exists");
    try {
      const obj = JSON.parse(jsonStr);
      const path = String(args[1]?.value ?? "$");
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      let exists = true;
      for (const p of parts) {
        if (cur === null || cur === undefined) {
          exists = false;
          break;
        }
        if (Array.isArray(cur)) {
          cur = typeof p === "number" ? cur[p] : undefined;
        } else if (typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[p as string];
        } else {
          exists = false;
          break;
        }
      }
      if (cur === undefined) exists = false;
      return fromJs((exists ? 1 : 0) as SqlPrimitive, undefined, {}, "json.json_exists");
    } catch {
      // Default behavior: return 0 on error (path not found)
      return fromJs(0 as SqlPrimitive, undefined, {}, "json.json_exists");
    }
  },
};

// JSON_VALUE(json, path) - extracts a scalar value from JSON
export const JSON_VALUE: SqlScalarFunction = {
  name: "JSON_VALUE",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_value");
    try {
      const obj = JSON.parse(jsonStr);
      const path = String(args[1]?.value ?? "$");
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) return nullTyped("json.json_value");
        if (Array.isArray(cur)) {
          cur = typeof p === "number" ? cur[p] : undefined;
        } else if (typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[p as string];
        } else {
          cur = undefined;
        }
      }
      if (cur === undefined) return nullTyped("json.json_value");
      // JSON_VALUE returns NULL if the value is not a scalar
      if (cur === null) return fromJs(null as unknown as SqlPrimitive, undefined, {}, "json.json_value");
      if (typeof cur === "object" || Array.isArray(cur)) {
        // Not a scalar - in strict SQL:2016, this would error, but we return NULL
        return nullTyped("json.json_value");
      }
      return fromJs(cur as SqlPrimitive, undefined, {}, "json.json_value");
    } catch {
      return nullTyped("json.json_value");
    }
  },
};

// JSON_KEYS(json [, path]) - returns JSON array of keys at path
export const JSON_KEYS: SqlScalarFunction = {
  name: "JSON_KEYS",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_keys");
    try {
      const obj = JSON.parse(jsonStr);
      const path = args.length > 1 ? String(args[1]?.value ?? "$") : "$";
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) return nullTyped("json.json_keys");
        if (Array.isArray(cur)) {
          cur = typeof p === "number" ? cur[p] : undefined;
        } else if (typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[p as string];
        } else {
          cur = undefined;
        }
      }
      if (cur === undefined) return nullTyped("json.json_keys");
      if (cur === null) return nullTyped("json.json_keys");
      if (typeof cur !== "object" || Array.isArray(cur)) {
        // Not an object - JSON_KEYS returns NULL
        return nullTyped("json.json_keys");
      }
      const keys = Object.keys(cur as Record<string, unknown>);
      return fromJs(JSON.stringify(keys) as SqlPrimitive, undefined, {}, "json.json_keys");
    } catch {
      return nullTyped("json.json_keys");
    }
  },
};

// JSON_CONTAINS(json1, json2) - tests whether json1 contains json2
export const JSON_CONTAINS: SqlScalarFunction = {
  name: "JSON_CONTAINS",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const json1Str = toStr(args[0]?.value ?? null);
    const json2Str = toStr(args[1]?.value ?? null);
    if (json1Str === null || json2Str === null) return nullTyped("json.json_contains");
    try {
      const json1 = JSON.parse(json1Str);
      const json2 = JSON.parse(json2Str);
      const contains = jsonContains(json1, json2);
      return fromJs((contains ? 1 : 0) as SqlPrimitive, undefined, {}, "json.json_contains");
    } catch {
      return nullTyped("json.json_contains");
    }
  },
};

// JSON_QUERY(json, path) - extracts a JSON document (not just scalar)
export const JSON_QUERY: SqlScalarFunction = {
  name: "JSON_QUERY",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const jsonStr = toStr(args[0]?.value ?? null);
    if (jsonStr === null) return nullTyped("json.json_query");
    try {
      const obj = JSON.parse(jsonStr);
      const path = String(args[1]?.value ?? "$");
      const parts = jsonGetPath(path);
      let cur: unknown = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) return nullTyped("json.json_query");
        if (Array.isArray(cur)) {
          cur = typeof p === "number" ? cur[p] : undefined;
        } else if (typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[p as string];
        } else {
          cur = undefined;
        }
      }
      if (cur === undefined) return nullTyped("json.json_query");
      if (cur === null) return fromJs("null" as SqlPrimitive, undefined, {}, "json.json_query");
      // JSON_QUERY returns NULL if the value is a scalar
      if (typeof cur !== "object" || cur === null) {
        return nullTyped("json.json_query");
      }
      return fromJs(JSON.stringify(cur) as SqlPrimitive, undefined, {}, "json.json_query");
    } catch {
      return nullTyped("json.json_query");
    }
  },
};

// Helper function to check JSON containment
function jsonContains(container: unknown, target: unknown): boolean {
  if (target === null) return true;
  if (container === null) return false;

  if (Array.isArray(target)) {
    if (!Array.isArray(container)) return false;
    // Check if all elements in target are contained in container
    for (const targetItem of target) {
      let found = false;
      for (const containerItem of container) {
        if (jsonContains(containerItem, targetItem)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  if (typeof target === "object") {
    if (typeof container !== "object" || container === null || Array.isArray(container)) return false;
    // Check if all key-value pairs in target are contained in container
    const targetObj = target as Record<string, unknown>;
    const containerObj = container as Record<string, unknown>;
    for (const key of Object.keys(targetObj)) {
      if (!(key in containerObj)) return false;
      if (!jsonContains(containerObj[key], targetObj[key])) return false;
    }
    return true;
  }

  // Scalar comparison
  return container === target;
}

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

function jsonExistsPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    let exists = true;
    for (const p of parts) {
      if (cur === null || cur === undefined) {
        exists = false;
        break;
      }
      if (Array.isArray(cur)) {
        cur = typeof p === "number" ? cur[p] : undefined;
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[p as string];
      } else {
        exists = false;
        break;
      }
    }
    if (cur === undefined) exists = false;
    return exists ? 1 : 0;
  } catch {
    return 0;
  }
}

function jsonValuePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      if (Array.isArray(cur)) {
        cur = typeof p === "number" ? cur[p] : undefined;
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[p as string];
      } else {
        cur = undefined;
      }
    }
    if (cur === undefined) return null;
    if (cur === null) return null;
    if (typeof cur === "object" || Array.isArray(cur)) {
      return null;
    }
    return cur as SqlPrimitive;
  } catch {
    return null;
  }
}

function jsonKeysPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      if (Array.isArray(cur)) {
        cur = typeof p === "number" ? cur[p] : undefined;
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[p as string];
      } else {
        cur = undefined;
      }
    }
    if (cur === undefined) return null;
    if (cur === null) return null;
    if (typeof cur !== "object" || Array.isArray(cur)) {
      return null;
    }
    const keys = Object.keys(cur as Record<string, unknown>);
    return JSON.stringify(keys) as SqlPrimitive;
  } catch {
    return null;
  }
}

function jsonContainsPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const json1Str = toStr(args[0]);
  const json2Str = toStr(args[1]);
  if (!json1Str || !json2Str) return null;
  try {
    const json1 = JSON.parse(json1Str);
    const json2 = JSON.parse(json2Str);
    return jsonContains(json1, json2) ? 1 : 0;
  } catch {
    return null;
  }
}

function jsonQueryPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const jsonStr = toStr(args[0]);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const path = args.length > 1 ? String(args[1] ?? "$") : "$";
    const parts = jsonGetPath(path);
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      if (Array.isArray(cur)) {
        cur = typeof p === "number" ? cur[p] : undefined;
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[p as string];
      } else {
        cur = undefined;
      }
    }
    if (cur === undefined) return null;
    if (cur === null) return "null";
    if (typeof cur !== "object" || cur === null) {
      return null;
    }
    return JSON.stringify(cur) as SqlPrimitive;
  } catch {
    return null;
  }
}

export const JSON_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  JSON_EXTRACT: { name: "JSON_EXTRACT", minArgs: 2, maxArgs: -1, evaluate: jsonExtractPrim },
  JSON_VALID: { name: "JSON_VALID", minArgs: 1, maxArgs: 1, evaluate: jsonValidPrim },
  JSON_TYPE: { name: "JSON_TYPE", minArgs: 2, maxArgs: 3, evaluate: jsonTypePrim },
  JSON_LENGTH: { name: "JSON_LENGTH", minArgs: 1, maxArgs: 2, evaluate: jsonLengthPrim },
  JSON_EXISTS: { name: "JSON_EXISTS", minArgs: 2, maxArgs: 3, evaluate: jsonExistsPrim },
  JSON_VALUE: { name: "JSON_VALUE", minArgs: 2, maxArgs: 2, evaluate: jsonValuePrim },
  JSON_KEYS: { name: "JSON_KEYS", minArgs: 1, maxArgs: 2, evaluate: jsonKeysPrim },
  JSON_CONTAINS: { name: "JSON_CONTAINS", minArgs: 2, maxArgs: 2, evaluate: jsonContainsPrim },
  JSON_QUERY: { name: "JSON_QUERY", minArgs: 2, maxArgs: 2, evaluate: jsonQueryPrim },
};
