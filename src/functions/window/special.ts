// Window functions: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, FIRST_VALUE, LAST_VALUE, NTH_VALUE, NTILE, PERCENT_RANK, CUME_DIST
import type { SqlWindowFunction } from "../types.js";
import type { SqlTypedValue, SqlRow, SqlPrimitive } from "../../types.js";
import { fromJs } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRowOrderValues(
  row: SqlRow,
  orderByColumns: Map<string, SqlPrimitive>,
): Map<string, SqlPrimitive> {
  const result = new Map<string, SqlPrimitive>();
  for (const [col] of orderByColumns) {
    result.set(col, (row[col] as SqlPrimitive) ?? null);
  }
  return result;
}

function orderValuesEqual(
  a: Map<string, SqlPrimitive>,
  b: Map<string, SqlPrimitive>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (v !== b.get(k)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ranking window functions
// ---------------------------------------------------------------------------

export const ROW_NUMBER: SqlWindowFunction = {
  name: "ROW_NUMBER",
  minArgs: 0,
  maxArgs: 0,
  evaluate(_args: SqlTypedValue[], context): SqlTypedValue {
    return fromJs(
      (context.rowIndex - context.partitionStart + 1) as SqlPrimitive,
      undefined,
      {},
      "window.row_number",
    );
  },
};

export const RANK: SqlWindowFunction = {
  name: "RANK",
  minArgs: 0,
  maxArgs: 0,
  evaluate(_args: SqlTypedValue[], context): SqlTypedValue {
    const rows = context.rows;
    const currentIdx = context.rowIndex - context.partitionStart;
    const currentOrder = context.orderByValues;
    let rank = 1;
    for (let i = 0; i < currentIdx; i++) {
      const peerRow = rows[context.partitionStart + i]!;
      const peerOrder = getRowOrderValues(peerRow, currentOrder);
      if (!orderValuesEqual(peerOrder, currentOrder)) rank++;
    }
    return fromJs(rank as SqlPrimitive, undefined, {}, "window.rank");
  },
};

export const DENSE_RANK: SqlWindowFunction = {
  name: "DENSE_RANK",
  minArgs: 0,
  maxArgs: 0,
  evaluate(_args: SqlTypedValue[], context): SqlTypedValue {
    const rows = context.rows;
    const currentIdx = context.rowIndex - context.partitionStart;
    const currentOrder = context.orderByValues;
    let rank = 1;
    for (let i = 0; i < currentIdx; i++) {
      const peerRow = rows[context.partitionStart + i]!;
      const peerOrder = getRowOrderValues(peerRow, currentOrder);
      if (!orderValuesEqual(peerOrder, currentOrder)) rank++;
    }
    return fromJs(rank as SqlPrimitive, undefined, {}, "window.dense_rank");
  },
};

// ---------------------------------------------------------------------------
// Offset window functions
// ---------------------------------------------------------------------------

export const LAG: SqlWindowFunction = {
  name: "LAG",
  minArgs: 1,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const offset = args.length >= 3 ? Number(args[2]?.value ?? 1) : 1;
    const defaultValue = args.length >= 2 ? args[1]?.value ?? null : null;
    const expr = String(args[0]?.value ?? "");
    const targetIdx = context.rowIndex - offset;
    if (targetIdx < context.partitionStart) {
      return fromJs(defaultValue as SqlPrimitive, undefined, {}, "window.lag");
    }
    const targetRow = context.rows[targetIdx]!;
    const value = (targetRow[expr] as SqlPrimitive) ?? defaultValue;
    return fromJs(value as SqlPrimitive, undefined, {}, "window.lag");
  },
};

export const LEAD: SqlWindowFunction = {
  name: "LEAD",
  minArgs: 1,
  maxArgs: 3,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const offset = args.length >= 3 ? Number(args[2]?.value ?? 1) : 1;
    const defaultValue = args.length >= 2 ? args[1]?.value ?? null : null;
    const expr = String(args[0]?.value ?? "");
    const targetIdx = context.rowIndex + offset;
    if (targetIdx > context.partitionEnd) {
      return fromJs(defaultValue as SqlPrimitive, undefined, {}, "window.lead");
    }
    const targetRow = context.rows[targetIdx]!;
    const value = (targetRow[expr] as SqlPrimitive) ?? defaultValue;
    return fromJs(value as SqlPrimitive, undefined, {}, "window.lead");
  },
};

// ---------------------------------------------------------------------------
// Value window functions
// ---------------------------------------------------------------------------

export const FIRST_VALUE: SqlWindowFunction = {
  name: "FIRST_VALUE",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    const firstRow = context.rows[context.frameStart]!;
    const value = (firstRow[expr] as SqlPrimitive) ?? null;
    return fromJs(value as SqlPrimitive, undefined, {}, "window.first_value");
  },
};

export const LAST_VALUE: SqlWindowFunction = {
  name: "LAST_VALUE",
  minArgs: 1,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    const lastRow = context.rows[context.frameEnd]!;
    const value = (lastRow[expr] as SqlPrimitive) ?? null;
    return fromJs(value as SqlPrimitive, undefined, {}, "window.last_value");
  },
};

export const NTH_VALUE: SqlWindowFunction = {
  name: "NTH_VALUE",
  minArgs: 2,
  maxArgs: 2,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const expr = String(args[0]?.value ?? "");
    const n = Number(args[1]?.value ?? null);
    if (!Number.isFinite(n) || n < 1) return fromJs(null, undefined, {}, "window.nth_value");
    const targetIdx = context.partitionStart + Math.floor(n) - 1;
    if (targetIdx > context.partitionEnd || targetIdx < context.partitionStart) {
      return fromJs(null, undefined, {}, "window.nth_value");
    }
    const targetRow = context.rows[targetIdx]!;
    const value = (targetRow[expr] as SqlPrimitive) ?? null;
    return fromJs(value as SqlPrimitive, undefined, {}, "window.nth_value");
  },
};

// ---------------------------------------------------------------------------
// Distribution window functions
// ---------------------------------------------------------------------------

export const NTILE: SqlWindowFunction = {
  name: "NTILE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], context): SqlTypedValue {
    const numBuckets = Number(args[0]?.value ?? null);
    if (!Number.isFinite(numBuckets) || numBuckets < 1) {
      return fromJs(null, undefined, {}, "window.ntile");
    }
    const totalRows = context.partitionEnd - context.partitionStart + 1;
    const bucketSize = totalRows / numBuckets;
    const rowPos = context.rowIndex - context.partitionStart;
    const bucket = Math.floor(rowPos / bucketSize) + 1;
    return fromJs(Math.min(bucket, numBuckets) as SqlPrimitive, undefined, {}, "window.ntile");
  },
};

export const PERCENT_RANK: SqlWindowFunction = {
  name: "PERCENT_RANK",
  minArgs: 0,
  maxArgs: 0,
  evaluate(_args: SqlTypedValue[], context): SqlTypedValue {
    const totalRows = context.partitionEnd - context.partitionStart + 1;
    if (totalRows <= 1) return fromJs(0 as SqlPrimitive, undefined, {}, "window.percent_rank");
    const rowPos = context.rowIndex - context.partitionStart;
    // RANK - 1 / total - 1
    const rows = context.rows;
    const currentOrder = context.orderByValues;
    let rank = 1;
    for (let i = 0; i < rowPos; i++) {
      const peerRow = rows[context.partitionStart + i]!;
      const peerOrder = getRowOrderValues(peerRow, currentOrder);
      if (!orderValuesEqual(peerOrder, currentOrder)) rank++;
    }
    const pctRank = (rank - 1) / (totalRows - 1);
    return fromJs(pctRank as SqlPrimitive, undefined, {}, "window.percent_rank");
  },
};

export const CUME_DIST: SqlWindowFunction = {
  name: "CUME_DIST",
  minArgs: 0,
  maxArgs: 0,
  evaluate(_args: SqlTypedValue[], context): SqlTypedValue {
    const rows = context.rows;
    const totalRows = context.partitionEnd - context.partitionStart + 1;
    const currentIdx = context.rowIndex - context.partitionStart;
    const currentOrder = context.orderByValues;
    // Count rows <= current row (including current)
    let countLTE = 0;
    for (let i = 0; i < totalRows; i++) {
      const peerRow = rows[context.partitionStart + i]!;
      const peerOrder = getRowOrderValues(peerRow, currentOrder);
      if (orderValuesEqual(peerOrder, currentOrder) || comparePeerOrder(peerRow, rows[context.partitionStart + currentIdx]!, currentOrder) <= 0) {
        countLTE++;
      }
    }
    return fromJs((countLTE / totalRows) as SqlPrimitive, undefined, {}, "window.cume_dist");
  },
};

function comparePeerOrder(
  left: SqlRow,
  right: SqlRow,
  orderByColumns: Map<string, SqlPrimitive>,
): number {
  for (const [col, dir] of orderByColumns) {
    const a = (left[col] as SqlPrimitive) ?? null;
    const b = (right[col] as SqlPrimitive) ?? null;
    if (a === b) continue;
    const cmp = String(a).localeCompare(String(b));
    if (cmp !== 0) return dir === "DESC" ? -cmp : cmp;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const WINDOW_FUNCTIONS: Record<string, SqlWindowFunction> = {
  ROW_NUMBER,
  RANK,
  DENSE_RANK,
  LAG,
  LEAD,
  FIRST_VALUE,
  LAST_VALUE,
  NTH_VALUE,
  NTILE,
  PERCENT_RANK,
  CUME_DIST,
};
