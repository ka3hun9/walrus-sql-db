import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { convertTypedValue, fromJs, normalizeRuntimeTypeName } from "../../types.js";
import { nullTyped } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function toStr(v: SqlPrimitive): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toNumber(v: SqlPrimitive): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const CAST: SqlScalarFunction = {
  name: "CAST",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const value = args[0];
    const targetRaw = args[1]?.value;
    if (!value || targetRaw === undefined || targetRaw === null) return nullTyped("type.cast");
    const normalizedTarget = normalizeRuntimeTypeName(String(targetRaw));
    if (!normalizedTarget || normalizedTarget === "NULL") return nullTyped("type.cast");
    try {
      let castInput = value;
      if (
        typeof castInput.value === "number"
        && Number.isFinite(castInput.value)
        && (normalizedTarget === "SMALLINT"
          || normalizedTarget === "INT"
          || normalizedTarget === "BIGINT"
          || normalizedTarget === "U64")
      ) {
        castInput = fromJs(Math.trunc(castInput.value), undefined, {}, "type.cast.truncate");
      }
      return convertTypedValue(castInput, normalizedTarget, {
        mode: "explicit",
        sourceContext: "type.cast",
      });
    } catch {
      return nullTyped("type.cast");
    }
  },
};

export const TYPEOF: SqlScalarFunction = {
  name: "TYPEOF",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0];
    if (v.value === null || v.value === undefined) return fromJs("null" as SqlPrimitive, undefined, {}, "type.typeof");
    if (typeof v.value === "number") {
      if (!Number.isFinite(v.value)) return fromJs("text" as SqlPrimitive, undefined, {}, "type.typeof");
      if (Number.isInteger(v.value)) return fromJs("integer" as SqlPrimitive, undefined, {}, "type.typeof");
      return fromJs("real" as SqlPrimitive, undefined, {}, "type.typeof");
    }
    if (typeof v.value === "boolean") return fromJs("integer" as SqlPrimitive, undefined, {}, "type.typeof");
    return fromJs(typeof v.value as SqlPrimitive, undefined, {}, "type.typeof");
  },
};

export const HEX: SqlScalarFunction = {
  name: "HEX",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (v === null || v === undefined) return nullTyped("type.hex");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return fromJs("4E414E" as SqlPrimitive, undefined, {}, "type.hex"); // "NAN"
      return fromJs(Math.trunc(v).toString(16).toUpperCase() as SqlPrimitive, undefined, {}, "type.hex");
    }
    if (typeof v === "string") {
      // Return hex of UTF-8 bytes
      const hex = [...Buffer.from(v, "utf8")].map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
      return fromJs(hex as SqlPrimitive, undefined, {}, "type.hex");
    }
    if (typeof v === "boolean") {
      return fromJs((v ? "1" : "0") as SqlPrimitive, undefined, {}, "type.hex");
    }
    return nullTyped("type.hex");
  },
};

export const UNICODE: SqlScalarFunction = {
  name: "UNICODE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const s = toStr(args[0]?.value ?? null);
    if (s === null) return nullTyped("type.unicode");
    const code = s.charCodeAt(0);
    return fromJs((code === undefined ? 0 : code) as SqlPrimitive, undefined, {}, "type.unicode");
  },
};

export const PRINTF: SqlScalarFunction = {
  name: "PRINTF",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const fmt = toStr(args[0]?.value ?? null);
    if (fmt === null) return nullTyped("type.printf");
    let result = fmt;
    let argIdx = 1;
    let i = 0;
    while (i < result.length) {
      if (result[i] === "%") {
        const next = result[i + 1];
        if (next === "d" || next === "i") {
          const v = args[argIdx++]?.value;
          result = result.slice(0, i) + String(toNumber(v) ?? 0) + result.slice(i + 2);
          i += String(toNumber(v) ?? 0).length - 1;
          continue;
        } else if (next === "s") {
          const v = args[argIdx++]?.value;
          result = result.slice(0, i) + String(v ?? "") + result.slice(i + 2);
          i += String(v ?? "").length - 1;
          continue;
        } else if (next === "f") {
          const v = args[argIdx++]?.value;
          result = result.slice(0, i) + String(toNumber(v) ?? 0.0) + result.slice(i + 2);
          i += String(toNumber(v) ?? 0.0).length - 1;
          continue;
        } else if (next === "x") {
          const v = args[argIdx++]?.value;
          result = result.slice(0, i) + Math.abs(toNumber(v) ?? 0).toString(16) + result.slice(i + 2);
          continue;
        } else if (next === "X") {
          const v = args[argIdx++]?.value;
          result = result.slice(0, i) + Math.abs(toNumber(v) ?? 0).toString(16).toUpperCase() + result.slice(i + 2);
          continue;
        } else if (next === "%") {
          result = result.slice(0, i) + "%" + result.slice(i + 2);
          continue;
        }
      }
      i++;
    }
    return fromJs(result as SqlPrimitive, undefined, {}, "type.printf");
  },
};

export const QUOTE: SqlScalarFunction = {
  name: "QUOTE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (v === null || v === undefined) return fromJs("NULL" as SqlPrimitive, undefined, {}, "type.quote");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return fromJs("'" + v + "'" as SqlPrimitive, undefined, {}, "type.quote");
      return fromJs(String(v) as SqlPrimitive, undefined, {}, "type.quote");
    }
    if (typeof v === "boolean") return fromJs(v ? "1" : "0" as SqlPrimitive, undefined, {}, "type.quote");
    const s = String(v);
    return fromJs(`'${s.replace(/'/g, "''")}'` as SqlPrimitive, undefined, {}, "type.quote");
  },
};

export const CHANGES: SqlScalarFunction = {
  name: "CHANGES",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    // Placeholder: actual value would come from client context
    return fromJs(0 as SqlPrimitive, undefined, {}, "type.changes");
  },
};

export const TOTAL_CHANGES: SqlScalarFunction = {
  name: "TOTAL_CHANGES",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(0 as SqlPrimitive, undefined, {}, "type.total_changes");
  },
};

export const LAST_INSERT_ROWID: SqlScalarFunction = {
  name: "LAST_INSERT_ROWID",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(0 as SqlPrimitive, undefined, {}, "type.last_insert_rowid");
  },
};

export const ROWID: SqlScalarFunction = {
  name: "ROWID",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(null as unknown as SqlPrimitive, undefined, {}, "type.rowid");
  },
};

export const OID: SqlScalarFunction = {
  name: "OID",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(null as unknown as SqlPrimitive, undefined, {}, "type.oid");
  },
};

export const SQLITE_VERSION: SqlScalarFunction = {
  name: "SQLITE_VERSION",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs("3.45.0" as SqlPrimitive, undefined, {}, "type.sqlite_version");
  },
};

export const SQLITE_SOURCE_ID: SqlScalarFunction = {
  name: "SQLITE_SOURCE_ID",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs("2024-01-15 11:37:53" as SqlPrimitive, undefined, {}, "type.sqlite_source_id");
  },
};

export const TXN_CURRENT: SqlScalarFunction = {
  name: "TXN_CURRENT",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(0 as SqlPrimitive, undefined, {}, "type.txn_current");
  },
};

export const TXN_DIFFERENCE: SqlScalarFunction = {
  name: "TXN_DIFFERENCE",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    return fromJs(0 as SqlPrimitive, undefined, {}, "type.txn_difference");
  },
};

// ============================================================================
// Primitive (string-replay) implementations
// ============================================================================

function typeofPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const v = args[0];
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "text";
    return Number.isInteger(v) ? "integer" : "real";
  }
  if (typeof v === "boolean") return "integer";
  return typeof v;
}

function hexPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const v = args[0];
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "4E414E";
    return Math.trunc(v).toString(16).toUpperCase();
  }
  if (typeof v === "string") {
    return [...Buffer.from(v, "utf8")].map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  return null;
}

function printfPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const fmt = toStr(args[0]);
  if (!fmt) return null;
  let result = fmt;
  let argIdx = 1;
  let i = 0;
  while (i < result.length) {
    if (result[i] === "%") {
      const next = result[i + 1];
      if (next === "d" || next === "i") {
        const v = args[argIdx++];
        result = result.slice(0, i) + String(toNumber(v) ?? 0) + result.slice(i + 2);
        i += String(toNumber(v) ?? 0).length - 1;
        continue;
      } else if (next === "s") {
        const v = args[argIdx++];
        result = result.slice(0, i) + String(v ?? "") + result.slice(i + 2);
        i += String(v ?? "").length - 1;
        continue;
      } else if (next === "f") {
        const v = args[argIdx++];
        result = result.slice(0, i) + String(toNumber(v) ?? 0.0) + result.slice(i + 2);
        i += String(toNumber(v) ?? 0.0).length - 1;
        continue;
      } else if (next === "x" || next === "X") {
        const v = args[argIdx++];
        result = result.slice(0, i) + Math.abs(toNumber(v) ?? 0).toString(16).toUpperCase() + result.slice(i + 2);
        i += Math.abs(toNumber(v) ?? 0).toString(16).length - 1;
        continue;
      } else if (next === "%") {
        result = result.slice(0, i) + "%" + result.slice(i + 2);
        continue;
      }
    }
    i++;
  }
  return result;
}

export const TYPE_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  TYPEOF: { name: "TYPEOF", minArgs: 1, maxArgs: 1, evaluate: typeofPrim },
  HEX: { name: "HEX", minArgs: 1, maxArgs: 1, evaluate: hexPrim },
  PRINTF: { name: "PRINTF", minArgs: 1, maxArgs: -1, evaluate: printfPrim },
  SQLITE_VERSION: { name: "SQLITE_VERSION", minArgs: 0, maxArgs: 0, evaluate: () => "3.45.0" },
};
