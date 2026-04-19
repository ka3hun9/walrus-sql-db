// Aggregate window functions: SUM, AVG, COUNT, MIN, MAX as window functions
import type { SqlWindowFunction } from "../types.js";
import type { SqlTypedValue, SqlRow, SqlPrimitive } from "../../types.js";
import { fromJs } from "../../types.js";
import { toTruthValue } from "../../sql-semantics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumbers(values: SqlPrimitive[]): number[] {
  return values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function compareValues(a: SqlPrimitive, b: SqlPrimitive): number {
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

// ---------------------------------------------------------------------------
// SUM OVER
// ---------------------------------------------------------------------------

export const SUM_OVER: SqlWindowFunction = {
  name: "SUM",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    const values: SqlPrimitive[] = [];
    for (let i = context.frameStart; i <= context.frameEnd; i++) {
      const row = context.rows[i]!;
      const val = row[expr];
      if (val !== null && val !== undefined) {
        values.push(val as SqlPrimitive);
      }
    }
    const nums = toNumbers(values);
    if (!nums.length) return fromJs(null, undefined, {}, "window.sum");
    const sum = nums.reduce((a, b) => a + b, 0);
    return fromJs(sum as SqlPrimitive, undefined, {}, "window.sum");
  },
};

// ---------------------------------------------------------------------------
// AVG OVER
// ---------------------------------------------------------------------------

export const AVG_OVER: SqlWindowFunction = {
  name: "AVG",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    const values: SqlPrimitive[] = [];
    for (let i = context.frameStart; i <= context.frameEnd; i++) {
      const row = context.rows[i]!;
      const val = row[expr];
      if (val !== null && val !== undefined) {
        values.push(val as SqlPrimitive);
      }
    }
    const nums = toNumbers(values);
    if (!nums.length) return fromJs(null, undefined, {}, "window.avg");
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return fromJs(avg as SqlPrimitive, undefined, {}, "window.avg");
  },
};

// ---------------------------------------------------------------------------
// COUNT OVER
// ---------------------------------------------------------------------------

export const COUNT_OVER: SqlWindowFunction = {
  name: "COUNT",
  minArgs: 0,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    let count = 0;
    if (args.length === 0) {
      // COUNT(*) counts all rows in frame (ensure non-negative)
      count = Math.max(0, context.frameEnd - context.frameStart + 1);
    } else {
      // COUNT(expr) counts non-null values
      const expr = String(args[0]?.value ?? "");
      for (let i = context.frameStart; i <= context.frameEnd; i++) {
        const row = context.rows[i]!;
        const val = row[expr];
        if (val !== null && val !== undefined) {
          count++;
        }
      }
    }
    return fromJs(count as SqlPrimitive, undefined, {}, "window.count");
  },
};

// ---------------------------------------------------------------------------
// MIN OVER
// ---------------------------------------------------------------------------

export const MIN_OVER: SqlWindowFunction = {
  name: "MIN",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    let minVal: SqlPrimitive | null = null;
    for (let i = context.frameStart; i <= context.frameEnd; i++) {
      const row = context.rows[i]!;
      const val = row[expr] as SqlPrimitive;
      if (val !== null && val !== undefined) {
        if (minVal === null) {
          minVal = val;
        } else if (compareValues(val, minVal) < 0) {
          minVal = val;
        }
      }
    }
    return fromJs(minVal, undefined, {}, "window.min");
  },
};

// ---------------------------------------------------------------------------
// MAX OVER
// ---------------------------------------------------------------------------

export const MAX_OVER: SqlWindowFunction = {
  name: "MAX",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    let maxVal: SqlPrimitive | null = null;
    for (let i = context.frameStart; i <= context.frameEnd; i++) {
      const row = context.rows[i]!;
      const val = row[expr] as SqlPrimitive;
      if (val !== null && val !== undefined) {
        if (maxVal === null) {
          maxVal = val;
        } else if (compareValues(val, maxVal) > 0) {
          maxVal = val;
        }
      }
    }
    return fromJs(maxVal, undefined, {}, "window.max");
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AGGREGATE_WINDOW_FUNCTIONS: Record<string, SqlWindowFunction> = {
  SUM: SUM_OVER,
  AVG: AVG_OVER,
  COUNT: COUNT_OVER,
  MIN: MIN_OVER,
  MAX: MAX_OVER,
};
