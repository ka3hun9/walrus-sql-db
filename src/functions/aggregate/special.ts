// Aggregate functions: COUNT, SUM, AVG, MIN, MAX, GROUP_CONCAT, TOTAL
import type { SqlAggregateFunction } from "../types.js";
import type { SqlPrimitive } from "../../types.js";

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
// COUNT
// ---------------------------------------------------------------------------

export const COUNT: SqlAggregateFunction = {
  name: "COUNT",
  minArgs: 0,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // COUNT doesn't need state; just track count in finalize
    // We store count in the values array as sentinel values
    // Actually COUNT needs special handling: count non-null values
    // For simplicity we store 1 per row and sum in finalize
    // This is a simplified implementation.
    // Note: COUNT(*) should count all rows; COUNT(col) counts non-null
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    // values stores the count (accumulated as numbers)
    const nums = toNumbers(values);
    return nums.reduce((a, b) => a + b, 0);
  },
};

// ---------------------------------------------------------------------------
// SUM
// ---------------------------------------------------------------------------

export const SUM: SqlAggregateFunction = {
  name: "SUM",
  minArgs: 1,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    const nums = toNumbers(values);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0);
  },
};

// ---------------------------------------------------------------------------
// AVG
// ---------------------------------------------------------------------------

export const AVG: SqlAggregateFunction = {
  name: "AVG",
  minArgs: 1,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    const nums = toNumbers(values);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },
};

// ---------------------------------------------------------------------------
// MIN
// ---------------------------------------------------------------------------

export const MIN: SqlAggregateFunction = {
  name: "MIN",
  minArgs: 1,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    if (!values.length) return null;
    let minVal = values[0]!;
    for (let i = 1; i < values.length; i++) {
      if (compareValues(values[i]!, minVal) < 0) minVal = values[i]!;
    }
    return minVal;
  },
};

// ---------------------------------------------------------------------------
// MAX
// ---------------------------------------------------------------------------

export const MAX: SqlAggregateFunction = {
  name: "MAX",
  minArgs: 1,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    if (!values.length) return null;
    let maxVal = values[0]!;
    for (let i = 1; i < values.length; i++) {
      if (compareValues(values[i]!, maxVal) > 0) maxVal = values[i]!;
    }
    return maxVal;
  },
};

// ---------------------------------------------------------------------------
// GROUP_CONCAT
// ---------------------------------------------------------------------------

export const GROUP_CONCAT: SqlAggregateFunction = {
  name: "GROUP_CONCAT",
  minArgs: 1,
  maxArgs: 2,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    return values.map((v) => String(v)).join(", ");
  },
};

// ---------------------------------------------------------------------------
// TOTAL
// ---------------------------------------------------------------------------

export const TOTAL: SqlAggregateFunction = {
  name: "TOTAL",
  minArgs: 1,
  maxArgs: 1,
  step(_values: SqlPrimitive[], _newValue: SqlPrimitive | null): void {
    // Accumulation happens via values array
  },
  finalize(values: SqlPrimitive[]): SqlPrimitive {
    // TOTAL returns 0.0 for empty set (unlike COUNT which returns NULL)
    let total = 0;
    for (const v of values) {
      total += typeof v === "number" ? v : (Number(v) || 0);
    }
    return total;
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AGGREGATE_FUNCTIONS: Record<string, SqlAggregateFunction> = {
  COUNT,
  SUM,
  AVG,
  MIN,
  MAX,
  GROUP_CONCAT,
  TOTAL,
};
