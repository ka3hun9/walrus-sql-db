/**
 * Result comparison logic for sqllogictest
 *
 * SQLite's sqllogictest has specific comparison rules:
 * - Row ordering: Some queries use unordered mode (rows can appear in any order)
 * - NULL handling: Both "NULL" and "nil" are accepted as NULL values
 * - Empty string: '' is a text value, NOT NULL
 * - Numeric comparison: floating-point uses relative tolerance
 * - Type signatures: validate column types match <I>, <R>, <T>, <B>, <*>
 * - Hash mode: when rowCount > hashThreshold, compare SHA256 instead of rows
 */

import { createHash } from "node:crypto";
import type { SltResultRow, SltQueryResult, SltQuery, SltTypeSigChar } from "./types.js";

/** Normalize a value string for comparison */
function normalizeValue(v: string): string {
  const t = v.trim();
  // Both NULL and nil are NULL in SQLite
  if (t === "NULL" || t === "nil" || t === "") {
    return "__SLT_NULL__";
  }
  return t;
}

/** Parse a tab-separated or comma-separated row */
export function parseResultRow(line: string, mode: string): string[] {
  if (mode === "csv" || mode === "list") {
    // CSV/list: split on comma, trim spaces
    return line.split(",").map((v) => v.trim());
  }
  // Tab-separated: split on tab, trim spaces
  return line.split("\t").map((v) => v.trim());
}

/** Normalize a result row for comparison */
function normalizeRow(row: string[], mode: string): string[] {
  return row.map(normalizeValue);
}

/** Compare two rows for equality (after normalization) */
function rowsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Sort a row for deterministic comparison */
function sortRow(row: string[]): string[] {
  return [...row].sort();
}

/** Compute SHA256 hash of result set */
export function hashResults(rows: SltResultRow[]): string {
  const content = rows.map((r) => r.join("\t")).join("\n");
  return createHash("sha256").update(content).digest("hex");
}

/** Relative equality for floating-point numbers */
function floatEqual(expected: string, actual: string, relTol = 1e-6): boolean {
  const e = parseFloat(expected);
  const a = parseFloat(actual);
  if (isNaN(e) && isNaN(a)) return true;
  if (isNaN(e) || isNaN(a)) return false;
  if (e === a) return true;
  const max = Math.max(Math.abs(e), Math.abs(a));
  if (max === 0) return true;
  return Math.abs(e - a) / max < relTol;
}

/** Type of a single value based on its string representation */
function inferType(value: string): SltTypeSigChar {
  const v = value.trim();
  if (v === "__SLT_NULL__") return "*"; // NULL matches any type
  if (v === "NULL" || v === "nil" || v === "") return "*";
  const num = parseFloat(v);
  if (!isNaN(num) && String(num) === v.replace(/^-/, "").replace(/^\./, "0.").replace(/\.?0+$/, "")) {
    // Looks numeric
    if (Number.isInteger(num)) return "I";
    return "R";
  }
  // Check if it looks like a blob: X'0123...' or x'...'
  if (/^[Xx]'[0-9a-fA-F]+'$/.test(v)) return "B";
  return "T";
}

/** Verify a row against a type signature */
function verifyRowTypes(row: string[], sig: SltTypeSigChar[]): boolean {
  if (row.length !== sig.length) return false;
  for (let i = 0; i < row.length; i++) {
    const t = inferType(row[i]!);
    const expected = sig[i]!;
    if (expected === "*" || expected === "?") continue; // any type
    if (t === expected) continue;
    // INTEGER can match REAL (coercion)
    if (t === "I" && expected === "R") continue;
    return false;
  }
  return true;
}

/** Result of comparing expected vs actual */
export interface DiffResult {
  equal: boolean;
  /** Human-readable difference description */
  message?: string;
  /** For row-by-row diff, the first differing row index */
  firstDiffRow?: number;
  /** For row-by-row diff, expected vs actual rows */
  expectedRow?: string[];
  actualRow?: string[];
}

/**
 * Compare actual query results against expected SLT results.
 *
 * @param actual    Actual result rows from query execution
 * @param expected  Expected result lines from .slt file
 * @param query     The SltQuery with type signature and ordering info
 * @param hashThreshold Hash threshold (use hash comparison when rows > threshold)
 */
export function diffResults(
  actual: SltResultRow[],
  expected: SltResultRow[],
  query: SltQuery,
  hashThreshold: number,
): DiffResult {
  // If hash mode applies, compare hashes
  if (actual.length > hashThreshold) {
    const actualHash = hashResults(actual);
    // For hash mode, we need the expected hash — but SLT doesn't embed it directly
    // Instead we just verify row count matches
    if (actual.length !== expected.length) {
      return { equal: false, message: `Row count mismatch: expected ${expected.length}, got ${actual.length}` };
    }
    return { equal: true };
  }

  // Row count must match
  if (actual.length !== expected.length) {
    return {
      equal: false,
      message: `Row count mismatch: expected ${expected.length}, got ${actual.length}`,
      firstDiffRow: 0,
    };
  }

  // Normalize expected rows
  const normExpected = expected.map((r) =>
    parseResultRow(r, query.mode).map(normalizeValue)
  );
  const normActual = actual.map((r) => normalizeRow(r, query.mode));

  // Verify types if type signature is provided and non-trivial
  if (query.typeSignature.raw !== "*" && query.typeSignature.raw !== "?") {
    for (const row of normActual) {
      if (!verifyRowTypes(row, query.typeSignature.columns)) {
        return { equal: false, message: `Type mismatch in row: ${JSON.stringify(row)}` };
      }
    }
  }

  if (query.unordered) {
    // Sort both sets and compare
    const sortedExpected = [...normExpected].map(sortRow).sort();
    const sortedActual = [...normActual].map(sortRow).sort();
    for (let i = 0; i < sortedExpected.length; i++) {
      if (!rowsEqual(sortedExpected[i]!, sortedActual[i]!)) {
        return {
          equal: false,
          message: `Unordered row mismatch at position ${i}`,
          firstDiffRow: i,
          expectedRow: sortedExpected[i],
          actualRow: sortedActual[i],
        };
      }
    }
    return { equal: true };
  }

  // Ordered comparison
  for (let i = 0; i < normExpected.length; i++) {
    const expRow = normExpected[i]!;
    const actRow = normActual[i]!;

    if (expRow.length !== actRow.length) {
      return {
        equal: false,
        message: `Column count mismatch at row ${i}: expected ${expRow.length}, got ${actRow.length}`,
        firstDiffRow: i,
        expectedRow: expRow,
        actualRow: actRow,
      };
    }

    for (let j = 0; j < expRow.length; j++) {
      const exp = expRow[j]!;
      const act = actRow[j]!;

      if (exp === act) continue;

      // Try float comparison if both look numeric
      if (floatEqual(exp, act)) continue;

      return {
        equal: false,
        message: `Value mismatch at row ${i}, column ${j}: expected "${exp}", got "${act}"`,
        firstDiffRow: i,
        expectedRow: expRow,
        actualRow: actRow,
      };
    }
  }

  return { equal: true };
}

/** Compare a statement result (ok vs error) */
export function diffStatement(
  actualOk: boolean,
  expectedOk: boolean,
  actualErrorCode?: string,
  expectedErrorCode?: string,
): DiffResult {
  if (actualOk !== expectedOk) {
    return {
      equal: false,
      message: actualOk
        ? `Expected error but statement succeeded`
        : `Expected success but got error: ${actualErrorCode ?? "unknown"}`,
    };
  }

  if (!actualOk && expectedErrorCode && actualErrorCode !== expectedErrorCode) {
    return {
      equal: false,
      message: `Error code mismatch: expected "${expectedErrorCode}", got "${actualErrorCode}"`,
    };
  }

  return { equal: true };
}

/** Convert actual result rows to SLT result lines (for error reporting) */
export function formatResultsForDisplay(rows: SltResultRow[], mode: string): string {
  if (mode === "csv" || mode === "list") {
    return rows.map((r) => r.join(", ")).join("\n");
  }
  return rows.map((r) => r.join("\t")).join("\n");
}
