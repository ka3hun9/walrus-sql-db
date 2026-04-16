// Unified function registry — assembles all scalar function modules
// and exposes them as SCALAR_FUNCTIONS (typed/AST path) and
// SCALAR_FUNCTIONS_PRIMITIVE (primitive/string-replay path).

import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "./types.js";
import type { EvalContext, EvalContextPrimitive } from "./types.js";
import type { SqlPrimitive } from "../types.js";
import type { SqlTypedValue } from "../types.js";
import { nullTyped } from "./types.js";

// ---------------------------------------------------------------------------
// Import all scalar function modules
// ---------------------------------------------------------------------------
import * as conditional from "./scalar/conditional.js";
import * as math from "./scalar/math.js";
import * as string from "./scalar/string.js";
import * as datetime from "./scalar/datetime.js";
import * as typeFn from "./scalar/type.js";
import * as regex from "./scalar/regex.js";
import * as json from "./scalar/json.js";
import * as aggregate from "./aggregate/special.js";
import * as windowFn from "./window/special.js";

// ---------------------------------------------------------------------------
// Build SCALAR_FUNCTIONS (typed path — SqlTypedValue throughout)
// ---------------------------------------------------------------------------
function buildScalarFunctions(): Record<string, SqlScalarFunction> {
  const map: Record<string, SqlScalarFunction> = {};

  // Conditional
  for (const fn of [conditional.COALESCE, conditional.NULLIF, conditional.IFNULL, conditional.IIF]) {
    map[fn.name] = fn;
  }

  // Math
  for (const fnName of [
    "ABS","CEIL","CEILING","FLOOR","ROUND","TRUNC","SQRT","POW","POWER",
    "MOD","SIGN","EXP","LN","LOG","LOG2","LOG10","SIN","COS","TAN",
    "ASIN","ACOS","ATAN","ATAN2","DEGREES","RADIANS","PI","RANDOM",
    "SQUARE","BITAND","BITOR","BITXOR","BITNOT","LSHIFT","RSHIFT",
  ] as const) {
    const fn = (math as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  // String
  for (const fnName of [
    "SUBSTR","SUBSTRING","LENGTH","CHAR_LENGTH","CHARACTER_LENGTH",
    "UPPER","UCASE","LOWER","LCASE","TRIM","LTRIM","RTRIM","REPLACE",
    "INSTR","LIKE","GLOB","REVERSE","CHAR","CONCAT","CONCAT_WS",
    "LPAD","RPAD","REPEAT","LEFT","RIGHT","QUOTE",
  ] as const) {
    const fn = (string as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  // Datetime
  for (const fnName of [
    "DATE","TIME","DATETIME","JULIANDAY","STRFTIME","NOW",
    "CURRENT_TIMESTAMP","CURRENT_DATE","CURRENT_TIME",
    "YEAR","MONTH","DAY","HOUR","MINUTE","SECOND",
  ] as const) {
    const fn = (datetime as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  // Type
  for (const fnName of [
    "CAST","TYPEOF","HEX","UNICODE","PRINTF","QUOTE",
    "CHANGES","TOTAL_CHANGES","LAST_INSERT_ROWID","ROWID","OID",
    "SQLITE_VERSION","SQLITE_SOURCE_ID","TXN_CURRENT","TXN_DIFFERENCE",
  ] as const) {
    const fn = (typeFn as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  // Regex
  for (const fnName of ["REGEXP","REGEXP_MATCH","REGEXP_EXTRACT","REGEXP_REPLACE","REGEXP_LIKE"] as const) {
    const fn = (regex as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  // JSON
  for (const fnName of [
    "JSON","JSON_EXTRACT","JSON_OBJECT","JSON_ARRAY","JSON_TYPE",
    "JSON_VALID","JSON_LENGTH","JSON_INSERT","JSON_SET","JSON_REMOVE",
  ] as const) {
    const fn = (json as unknown as Record<string, SqlScalarFunction>)[fnName];
    if (fn) map[fnName] = fn;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Build SCALAR_FUNCTIONS_PRIMITIVE (primitive path — SqlPrimitive throughout)
// ---------------------------------------------------------------------------
function buildScalarFunctionsPrimitive(): Record<string, SqlScalarFunctionPrimitive> {
  const map: Record<string, SqlScalarFunctionPrimitive> = {};

  // Conditional
  Object.assign(map, conditional.CONDITIONAL_PRIMITIVE_FUNCTIONS);

  // Math
  Object.assign(map, math.MATH_PRIMITIVE_FUNCTIONS);

  // String
  Object.assign(map, string.STRING_PRIMITIVE_FUNCTIONS);

  // Datetime
  Object.assign(map, datetime.DATETIME_PRIMITIVE_FUNCTIONS);

  // Type
  Object.assign(map, typeFn.TYPE_PRIMITIVE_FUNCTIONS);

  // Regex
  Object.assign(map, regex.REGEX_PRIMITIVE_FUNCTIONS);

  // JSON
  Object.assign(map, json.JSON_PRIMITIVE_FUNCTIONS);

  return map;
}

// ---------------------------------------------------------------------------
// Public registries
// ---------------------------------------------------------------------------
export const SCALAR_FUNCTIONS = buildScalarFunctions();
export const SCALAR_FUNCTIONS_PRIMITIVE = buildScalarFunctionsPrimitive();
export const AGGREGATE_FUNCTIONS = aggregate.AGGREGATE_FUNCTIONS;
export const WINDOW_FUNCTIONS = windowFn.WINDOW_FUNCTIONS;

// ---------------------------------------------------------------------------
// Helper: check if a function name is registered (case-insensitive)
// ---------------------------------------------------------------------------
export function isRegisteredFunction(name: string): boolean {
  return SCALAR_FUNCTIONS[name.toUpperCase()] !== undefined;
}

// ---------------------------------------------------------------------------
// Helper: get registered function names
// ---------------------------------------------------------------------------
export function getRegisteredFunctions(): string[] {
  return Object.keys(SCALAR_FUNCTIONS).sort();
}

// ---------------------------------------------------------------------------
// Typed-eval dispatcher (used by sql-ast-eval.ts)
// ---------------------------------------------------------------------------
export function evaluateScalarFunction(
  name: string,
  args: SqlTypedValue[],
  context: EvalContext,
): SqlTypedValue {
  const fn = SCALAR_FUNCTIONS[name.toUpperCase()];
  if (!fn) return nullTyped(`function.${name}`);
  try {
    return fn.evaluate(args, context);
  } catch {
    return nullTyped(`function.${fn.name}`);
  }
}

// ---------------------------------------------------------------------------
// Primitive-eval dispatcher (used by query-replay.ts)
// ---------------------------------------------------------------------------
export function evaluateScalarFunctionPrimitive(
  name: string,
  args: SqlPrimitive[],
  context: EvalContextPrimitive,
): SqlPrimitive | null {
  const fn = SCALAR_FUNCTIONS_PRIMITIVE[name.toUpperCase()];
  if (!fn) return null;
  try {
    return fn.evaluate(args, context);
  } catch {
    return null;
  }
}
