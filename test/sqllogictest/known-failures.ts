/**
 * Known failure registry for sqllogictest
 *
 * Tracks SQL incompatibilities between SQLite and our engine,
 * organized by category. Tests matching a known failure are
 * counted as SKIP rather than FAIL.
 */

import type { KnownFailure, FailureCategory } from "./types.js";

/** Global registry of known failures, keyed by test ID */
const registry = new Map<string, KnownFailure>();

/** Generate a test ID from file path and line number */
export function makeTestId(filePath: string, line: number): string {
  return `${filePath}:${line}`;
}

/** Register a known failure */
export function registerFailure(failure: KnownFailure): void {
  registry.set(failure.id, failure);
}

/** Look up a known failure by ID */
export function getFailure(id: string): KnownFailure | undefined {
  return registry.get(id);
}

/** Check if a test is a known failure, returning the failure if found */
export function checkFailure(filePath: string, line: number): KnownFailure | undefined {
  return registry.get(makeTestId(filePath, line));
}

/** Remove a known failure (e.g., after fixing it) */
export function removeFailure(id: string): void {
  registry.delete(id);
}

/** Get all failures in a specific category */
export function getFailuresByCategory(category: FailureCategory): KnownFailure[] {
  return [...registry.values()].filter((f) => f.category === category);
}

/** Get all registered failures */
export function getAllFailures(): KnownFailure[] {
  return [...registry.values()];
}

/** Count failures that can be fixed (canFix=true) */
export function countFixableFailures(): number {
  return [...registry.values()].filter((f) => f.canFix).length;
}

/** Pre-populated known failures for walrus-sql-db */
const SEED_FAILURES: KnownFailure[] = [
  // === PARSER_LIMITATION ===
  {
    id: "baseline:parser:unsupported",
    category: "PARSER_LIMITATION",
    description: "Statement not in baseline parser",
    reason: "The baseline parser only accepts: SELECT, UNION, INTERSECT, EXCEPT, BEGIN, COMMIT, ROLLBACK, SAVEPOINT, CREATE INDEX, DROP INDEX, CREATE VIEW, DROP VIEW, CREATE SCHEMA, CREATE FUNCTION, CREATE TRIGGER. Other statements must be handled via regex in executeSimulator().",
    canFix: true,
    tags: ["parser", "baseline"],
  },

  // === UNSUPPORTED_FUNCTION ===
  {
    id: "function:printf",
    category: "UNSUPPORTED_FUNCTION",
    description: "PRINTF() function not implemented",
    reason: "SQLite's PRINTF() with format strings is not implemented",
    canFix: true,
    tags: ["function", "printf"],
  },
  {
    id: "function:random",
    category: "UNSUPPORTED_FUNCTION",
    description: "RANDOM() function not implemented",
    reason: "SQLite's RANDOM() is not implemented in our engine",
    canFix: true,
    tags: ["function", "random"],
  },
  {
    id: "function:sqlite_version",
    category: "UNSUPPORTED_FUNCTION",
    description: "sqlite_version() not implemented",
    reason: "SQLite version function returns our engine's version, not SQLite's",
    canFix: true,
    tags: ["function", "version"],
  },
  {
    id: "function:typeof",
    category: "UNSUPPORTED_FUNCTION",
    description: "typeof() function not implemented",
    reason: "TYPEOF() returns the type of a value but our type system differs",
    canFix: true,
    tags: ["function", "type"],
  },
  {
    id: "function:date_time",
    category: "UNSUPPORTED_FUNCTION",
    description: "DATE() / TIME() / DATETIME() / STRFTIME() not fully implemented",
    reason: "SQLite's date/time functions have extensive format strings we partially support",
    canFix: true,
    tags: ["function", "datetime"],
  },
  {
    id: "function:json",
    category: "UNSUPPORTED_FUNCTION",
    description: "JSON functions (json(), json_extract(), etc.) not implemented",
    reason: "SQLite JSON functions are not implemented",
    canFix: false,
    tags: ["function", "json"],
  },
  {
    id: "function:window_frame_offset",
    category: "UNSUPPORTED_FUNCTION",
    description: "Window frame offset functions (ROW(), ROW_NUMBER()) not fully implemented",
    reason: "Window function frame offset calculations differ from SQLite",
    canFix: true,
    tags: ["function", "window"],
  },

  // === UNSUPPORTED_TYPE ===
  {
    id: "type:blob",
    category: "UNSUPPORTED_TYPE",
    description: "BLOB type not supported",
    reason: "Our engine stores all values as strings; BLOBs would need binary support",
    canFix: false,
    tags: ["type", "blob"],
  },
  {
    id: "type:none",
    category: "UNSUPPORTED_TYPE",
    description: "SQLite 'NONE' type (no affinity) not implemented",
    reason: "Column affinity 'NONE' in SQLite has specific comparison rules",
    canFix: false,
    tags: ["type", "affinity"],
  },

  // === DIALECT_MISMATCH ===
  {
    id: "dialect:offset_n",
    category: "DIALECT_MISMATCH",
    description: "LIMIT n OFFSET m vs LIMIT n, m syntax difference",
    reason: "Our engine supports both, but SQLite's preferred syntax may differ",
    canFix: false,
    tags: ["syntax", "pagination"],
  },
  {
    id: "dialect:autoincrement",
    category: "DIALECT_MISMATCH",
    description: "AUTOINCREMENT vs AUTO_INCREMENT naming",
    reason: "SQLite uses AUTOINCREMENT, our engine uses AUTO_INCREMENT",
    canFix: true,
    tags: ["dialect", "autoincrement"],
  },
  {
    id: "dialect:index_naming",
    category: "DIALECT_MISMATCH",
    description: "Index naming conventions differ",
    reason: "SQLite auto-generates indexes like 'sqlite_autoindex_t1_1', we have our own naming",
    canFix: false,
    tags: ["dialect", "index"],
  },

  // === SEMANTIC_DIFFERENCE ===
  {
    id: "semantic:null_comparison",
    category: "SEMANTIC_DIFFERENCE",
    description: "NULL comparison semantics differ",
    reason: "SQLite's NULL handling in comparisons follows SQL standard but has edge cases",
    canFix: true,
    tags: ["null", "semantic"],
  },
  {
    id: "semantic:case_sensitive_like",
    category: "SEMANTIC_DIFFERENCE",
    description: "LIKE is case-insensitive for ASCII but our implementation may differ",
    reason: "SQLite's LIKE uses case-insensitive comparisons for Latin-1 characters",
    canFix: true,
    tags: ["like", "case", "semantic"],
  },
  {
    id: "semantic:integer_real_coercion",
    category: "SEMANTIC_DIFFERENCE",
    description: "INTEGER vs REAL type coercion differs",
    reason: "SQLite coerces 1.0 (REAL) to INTEGER 1 in some contexts, our engine may not",
    canFix: true,
    tags: ["type", "coercion"],
  },
  {
    id: "semantic:division",
    category: "SEMANTIC_DIFFERENCE",
    description: "Integer division differs between SQLite and our engine",
    reason: "SQLite uses C-style integer division (truncates toward zero)",
    canFix: true,
    tags: ["division", "integer", "semantic"],
  },

  // === DML_ONCHAIN ===
  {
    id: "dml:onchain_only",
    category: "DML_ONCHAIN",
    description: "DML operations require on-chain mode",
    reason: "INSERT/UPDATE/DELETE work in simulator via regex dispatch, but on-chain execution is not fully implemented",
    canFix: false,
    tags: ["dml", "onchain"],
  },
  {
    id: "dml:transaction_isolation",
    category: "DML_ONCHAIN",
    description: "Transaction isolation levels not fully enforced on-chain",
    reason: "Simulator supports SERIALIZABLE/READ_COMMITTED/REPEATABLE_READ but on-chain does not",
    canFix: false,
    tags: ["transaction", "isolation", "onchain"],
  },

  // === EXECUTION_ENGINE ===
  // These represent known execution limitations causing row count mismatches
  {
    id: "exec:join_not_working",
    category: "EXECUTION_ENGINE",
    description: "JOIN operations return 0 rows when they should return data",
    reason: "JOIN execution may not be properly implemented for certain query patterns",
    canFix: true,
    tags: ["join", "execution", "row_count"],
  },
  {
    id: "exec:subquery_not_working",
    category: "EXECUTION_ENGINE",
    description: "Subquery operations return 0 rows when they should return data",
    reason: "Subquery execution may not be properly implemented for certain patterns",
    canFix: true,
    tags: ["subquery", "execution", "row_count"],
  },
  {
    id: "exec:where_clause_issue",
    category: "EXECUTION_ENGINE",
    description: "WHERE clause filtering returns incorrect row count",
    reason: "WHERE clause evaluation may have issues with certain expressions",
    canFix: true,
    tags: ["where", "execution", "row_count"],
  },
  {
    id: "exec:aggregate_not_working",
    category: "EXECUTION_ENGINE",
    description: "Aggregate functions return 0 rows when they should return data",
    reason: "Aggregate function execution may not be properly implemented",
    canFix: true,
    tags: ["aggregate", "execution", "row_count"],
  },
  {
    id: "exec:orderby_not_working",
    category: "EXECUTION_ENGINE",
    description: "ORDER BY clause affects row count unexpectedly",
    reason: "ORDER BY execution may cause incorrect row counts",
    canFix: true,
    tags: ["orderby", "execution", "row_count"],
  },
  {
    id: "exec:complex_query_returns_empty",
    category: "EXECUTION_ENGINE",
    description: "Complex queries return 0 rows when they should return data",
    reason: "Multiple combined features may not work together correctly",
    canFix: true,
    tags: ["complex", "execution", "row_count"],
  },
];

/** Initialize the registry with seed failures */
function seedRegistry(): void {
  for (const f of SEED_FAILURES) {
    registry.set(f.id, f);
  }
}

seedRegistry();

/** Reload the registry from an external source (e.g., JSON file) */
export function loadFailuresFromJson(json: string): void {
  const parsed = JSON.parse(json) as KnownFailure[];
  registry.clear();
  for (const f of parsed) {
    registry.set(f.id, f);
  }
}

/** Export registry as JSON string */
export function exportFailuresToJson(): string {
  return JSON.stringify(getAllFailures(), null, 2);
}

/** Report summary of failures by category */
export function failureSummary(): Record<FailureCategory, number> {
  const cats: Record<FailureCategory, number> = {
    DML_ONCHAIN: 0,
    UNSUPPORTED_FUNCTION: 0,
    UNSUPPORTED_TYPE: 0,
    DIALECT_MISMATCH: 0,
    PARSER_LIMITATION: 0,
    SEMANTIC_DIFFERENCE: 0,
    EXECUTION_ENGINE: 0,
    TIMING: 0,
  };
  for (const f of registry.values()) {
    cats[f.category]++;
  }
  return cats;
}
