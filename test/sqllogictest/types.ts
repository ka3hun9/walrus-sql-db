/**
 * sqllogictest file format type definitions
 *
 * Format reference: SQLite sqllogictest / datafusion sqllogictest
 *
 * Token types:
 * - comment:      # comment line
 * - blank:        empty line (separator)
 * - statement:    statement ok / statement error <code> / statement <mode>
 * - query:        query <mode> <typesig>
 * - hash-threshold: hash-threshold <n>
 * - skipif:       skipif <condition>
 * - onlyif:       onlyif <condition>
 * - halt:         stop processing file
 * - loop:         loop <var> <start> <end> ... end loop
 * - mode change:  other directives (mode changed via query header)
 */

export type SltMode = "csv" | "list" | "column" | "insert" | string;

export type SltTypeSigChar = "I" | "R" | "T" | "B" | "*" | "?";

export interface SltTypeSignature {
  raw: string;      // e.g., "IIT*"
  columns: SltTypeSigChar[];
}

/** A single SQL statement block (either statement or query) */
export interface SltBlock {
  /** 1-indexed line number in source file */
  line: number;
}

/** statement ok / statement error <code> / statement <mode> */
export interface SltStatement extends SltBlock {
  kind: "statement";
  /** "ok" | "error" | "raw mode string" */
  type: string;
  /** Expected error code (only for type="error") */
  errorCode?: string;
  /** SQL text (may contain multiple statements separated by semicolons) */
  sql: string;
  /** skipif guards - skip test if any condition matches */
  skipIf: string[];
  /** onlyif guards - skip test unless all conditions match */
  onlyIf: string[];
  /** Playback speed multiplier for timing tests (not commonly used) */
  sleepMs?: number;
}

/** query <mode> <typesig>\nSELECT ...\n----\nresults... */
export interface SltQuery extends SltBlock {
  kind: "query";
  /** Output mode: "csv", "list", "column", etc. */
  mode: SltMode;
  /** Column type signatures e.g. "IIT*" */
  typeSignature: SltTypeSignature;
  /** SQL query text */
  sql: string;
  /** skipif guards */
  skipIf: string[];
  /** onlyif guards */
  onlyIf: string[];
  /** Expected results (raw lines) */
  results: string[];
  /** True if result order is not guaranteed */
  unordered: boolean;
  /** Sort priority for unordered results (lower = higher priority) */
  sortPriority?: number;
}

/** # ... comment (preserved for traceability) */
export interface SltComment extends SltBlock {
  kind: "comment";
  text: string;
}

/** blank line (separator, carries no semantic meaning) */
export interface SltBlank extends SltBlock {
  kind: "blank";
}

/** loop <var> <start> <end> ... end loop */
export interface SltLoop extends SltBlock {
  kind: "loop";
  variable: string;
  start: number;
  end: number;
  /** Expanded blocks (filled in by parser) */
  body: SltBlock[];
}

/** skipif <condition> - skip entire file if condition matches */
export interface SltSkipIf extends SltBlock {
  kind: "skipif";
  condition: string;
}

/** onlyif <condition> - skip entire file unless condition matches */
export interface SltOnlyIf extends SltBlock {
  kind: "onlyif";
  condition: string;
}

/** halt - stop processing this file */
export interface SltHalt extends SltBlock {
  kind: "halt";
}

/** hash-threshold <n> - use hash comparison when result set > n rows */
export interface SltHashThreshold extends SltBlock {
  kind: "hash-threshold";
  threshold: number;
}

/** Any directive we don't explicitly handle yet */
export interface SltUnknown extends SltBlock {
  kind: "unknown";
  text: string;
}

export type SltElement =
  | SltStatement
  | SltQuery
  | SltComment
  | SltBlank
  | SltLoop
  | SltSkipIf
  | SltHalt
  | SltHashThreshold
  | SltUnknown;

/** Parsed .slt file */
export interface SltDocument {
  /** Original file path (for error reporting) */
  filePath: string;
  /** All parsed elements in order */
  elements: SltElement[];
  /** File-level skipif conditions (entire file skipped if any matches) */
  fileSkipIf: string[];
  /** File-level onlyif conditions (entire file skipped unless all match) */
  fileOnlyIf: string[];
  /** hash-threshold set in this file */
  hashThreshold: number;
  /** True if a halt directive was encountered */
  halted: boolean;
}

/** Query result row (array of strings — raw from SQLite output) */
export type SltResultRow = string[];

/** Query results ready for comparison */
export interface SltQueryResult {
  /** Column values, one row per entry */
  rows: SltResultRow[];
  /** Column count from type signature */
  columnCount: number;
  /** row count */
  rowCount: number;
  /** SHA256 hash (used when rowCount > hashThreshold) */
  hash?: string;
}

/** Statement execution result */
export interface SltStatementResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/** Unified test element result */
export type SltResult =
  | { status: "skipped"; reason: string }
  | { status: "passed" }
  | { status: "failed"; message: string; expected?: string; actual?: string }
  | { status: "halted" };

/** Run result for a single file */
export interface SltFileRunResult {
  filePath: string;
  fileSkipped: boolean;
  skipReason?: string;
  halted: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  failures: SltResult[];
}

/** Known failure category */
export type FailureCategory =
  | "DML_ONCHAIN"      // INSERT/UPDATE/DELETE requiring on-chain mode
  | "UNSUPPORTED_FUNCTION" // SQLite function not implemented
  | "UNSUPPORTED_TYPE"    // SQLite-specific type (BLOB, etc.)
  | "DIALECT_MISMATCH"    // Feature differs between SQLite and our dialect
  | "PARSER_LIMITATION"   // Statement hits baseline parser limit
  | "SEMANTIC_DIFFERENCE" // Same SQL, different semantics (NULL, type coercion)
  | "TIMING";             // Race condition or timeout (not applicable to simulator)

/** A known incompatibility entry */
export interface KnownFailure {
  id: string;
  category: FailureCategory;
  description: string;
  reason: string;
  /** Whether this can be fixed (vs. intentional limitation) */
  canFix: boolean;
  /** Tags for filtering */
  tags: string[];
}
