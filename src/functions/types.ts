import type { SqlRow, SqlPrimitive } from "../types.js";
import type { SqlTypedValue } from "../types.js";
import { fromJs } from "../types.js";

// ============================================================================
// Context interfaces
// ============================================================================

export interface EvalContext {
  row: SqlRow;
  resolve: (name: string) => SqlTypedValue | undefined;
}

export interface EvalContextPrimitive {
  row: SqlRow;
}

// ============================================================================
// Function interfaces
// ============================================================================

export interface SqlScalarFunction {
  name: string;
  minArgs: number;
  maxArgs: number; // -1 = variadic
  evaluate(args: SqlTypedValue[], context: EvalContext): SqlTypedValue;
}

export interface SqlScalarFunctionPrimitive {
  name: string;
  minArgs: number;
  maxArgs: number; // -1 = variadic
  evaluate(args: SqlPrimitive[], context: EvalContextPrimitive): SqlPrimitive | null;
}

// Aggregate function operates over a set of values
export interface SqlAggregateFunction {
  name: string;
  minArgs: number;
  maxArgs: number;
  step(values: SqlPrimitive[], newValue: SqlPrimitive | null): void;
  finalize(values: SqlPrimitive[]): SqlPrimitive;
}

// Window function context
export interface SqlWindowFunction {
  name: string;
  minArgs: number;
  maxArgs: number;
  evaluate(
    args: SqlTypedValue[],
    context: WindowContext
  ): SqlTypedValue;
}

export interface WindowContext {
  rows: SqlRow[];
  rowIndex: number;
  partitionStart: number;
  partitionEnd: number;
  orderByValues: Map<string, SqlPrimitive>;
  frameStart: number;
  frameEnd: number;
}

// ============================================================================
// Helpers
// ============================================================================

export function checkArity(fn: string, args: unknown[], min: number, max: number): void {
  const len = args.length;
  if (len < min) {
    throw new Error(`Function ${fn} requires at least ${min} argument(s), got ${len}`);
  }
  if (max !== -1 && len > max) {
    throw new Error(`Function ${fn} accepts at most ${max} argument(s), got ${len}`);
  }
}

export function nullTyped(sourceContext: string): SqlTypedValue {
  return fromJs(null, undefined, {}, sourceContext);
}
