/**
 * Failure Analyzer for sqllogictest
 *
 * Provides detailed failure categorization and sample extraction
 * for diagnosing compatibility issues.
 */

import { parseSlt } from "./parser.js";
import { runSltFile } from "./runner.js";
import type { SqlClient } from "./runner.js";
import type { SltResult, SltFileRunResult } from "./types.js";

export interface FailureCategory {
  rowCountZero: number;
  rowCountMismatch: number;
  typeMismatch: number;
  unexpectedException: number;
  unknownIdentifier: number;
  other: number;
}

export interface FailurePattern {
  pattern: string;
  count: number;
  samples: Array<{ file: string; line: number; sql?: string; message: string }>;
}

export interface FailureAnalysis {
  total: number;
  categories: FailureCategory;
  patterns: FailurePattern[];
  fileStats: Array<{ file: string; failures: number; samples: string[] }>;
}

/**
 * Analyze a single failure to categorize it
 */
function categorizeFailure(msg: string): keyof FailureCategory {
  if (msg.includes("Row count mismatch: expected") && msg.includes(", got 0")) {
    return "rowCountZero";
  }
  if (msg.includes("Row count mismatch")) {
    return "rowCountMismatch";
  }
  if (msg.includes("Type mismatch in row")) {
    return "typeMismatch";
  }
  if (msg.includes("Unexpected exception")) {
    return "unexpectedException";
  }
  if (msg.includes("Unknown identifier")) {
    return "unknownIdentifier";
  }
  return "other";
}

/**
 * Extract SQL from a failure message or reconstruct from context
 */
function extractSqlFromFailure(failure: SltResult): string | undefined {
  if (failure.status !== "failed") return undefined;
  // Try to extract from message if it contains SQL
  const match = failure.message.match(/SQL:?\s*`([^`]+)`/i);
  if (match) return match[1];
  return undefined;
}

/**
 * Run failure analysis on a single test file
 */
export async function analyzeFile(
  fileName: string,
  content: string,
  makeClient: () => SqlClient,
): Promise<FailureAnalysis> {
  const result = await runSltFile(fileName, content, makeClient, {
    engine: "walrus",
    engineVersion: "0.3.0",
    mode: "simulator",
  });

  const categories: FailureCategory = {
    rowCountZero: 0,
    rowCountMismatch: 0,
    typeMismatch: 0,
    unexpectedException: 0,
    unknownIdentifier: 0,
    other: 0,
  };

  const patternMap = new Map<string, FailurePattern>();
  const fileStats: Array<{ file: string; failures: number; samples: string[] }> = [];

  for (const failure of result.failures) {
    if (failure.status !== "failed") continue;

    const cat = categorizeFailure(failure.message);
    categories[cat]++;

    // Extract pattern for grouping
    let pattern = failure.message.substring(0, 80);
    if (pattern.length === 80) pattern += "...";

    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, {
        pattern,
        count: 0,
        samples: [],
      });
    }
    const p = patternMap.get(pattern)!;
    p.count++;

    if (p.samples.length < 3) {
      p.samples.push(`${result.filePath}:${failure.message.substring(0, 100)}`);
    }
  }

  if (result.failures.length > 0) {
    fileStats.push({
      file: result.filePath,
      failures: result.failures.filter((f) => f.status === "failed").length,
      samples: result.failures
        .slice(0, 5)
        .filter((f) => f.status === "failed")
        .map((f) => f.message.substring(0, 100)),
    });
  }

  return {
    total: result.testsRun,
    categories,
    patterns: [...patternMap.values()].sort((a, b) => b.count - a.count),
    fileStats,
  };
}

/**
 * Run failure analysis on multiple test files
 */
export async function analyzeFiles(
  files: Array<{ name: string; content: string }>,
  makeClient: () => SqlClient,
): Promise<FailureAnalysis> {
  const results = await Promise.all(
    files.map((f) => analyzeFile(f.name, f.content, makeClient)),
  );

  const combined: FailureAnalysis = {
    total: 0,
    categories: {
      rowCountZero: 0,
      rowCountMismatch: 0,
      typeMismatch: 0,
      unexpectedException: 0,
      unknownIdentifier: 0,
      other: 0,
    },
    patterns: [],
    fileStats: [],
  };

  for (const r of results) {
    combined.total += r.total;
    combined.categories.rowCountZero += r.categories.rowCountZero;
    combined.categories.rowCountMismatch += r.categories.rowCountMismatch;
    combined.categories.typeMismatch += r.categories.typeMismatch;
    combined.categories.unexpectedException += r.categories.unexpectedException;
    combined.categories.unknownIdentifier += r.categories.unknownIdentifier;
    combined.categories.other += r.categories.other;
    combined.fileStats.push(...r.fileStats);
  }

  // Merge patterns
  const patternMap = new Map<string, FailurePattern>();
  for (const r of results) {
    for (const p of r.patterns) {
      if (!patternMap.has(p.pattern)) {
        patternMap.set(p.pattern, { ...p, samples: [] });
      }
      const existing = patternMap.get(p.pattern)!;
      existing.count += p.count;
      existing.samples.push(...p.samples.slice(0, 3 - existing.samples.length));
    }
  }
  combined.patterns = [...patternMap.values()].sort((a, b) => b.count - a.count);

  return combined;
}

/**
 * Print analysis results to console
 */
export function printAnalysis(analysis: FailureAnalysis): void {
  console.log("\n" + "=".repeat(60));
  console.log("FAILURE ANALYSIS REPORT");
  console.log("=".repeat(60));

  console.log(`\nTotal Tests Run: ${analysis.total}`);

  console.log("\n--- Failure Categories ---");
  const cat = analysis.categories;
  console.log(`  Row count 0:       ${cat.rowCountZero}`);
  console.log(`  Row count mismatch: ${cat.rowCountMismatch}`);
  console.log(`  Type mismatch:     ${cat.typeMismatch}`);
  console.log(`  Unexpected exn:    ${cat.unexpectedException}`);
  console.log(`  Unknown identifier: ${cat.unknownIdentifier}`);
  console.log(`  Other:             ${cat.other}`);

  console.log("\n--- Top 20 Failure Patterns ---");
  for (const p of analysis.patterns.slice(0, 20)) {
    console.log(`  [${p.count}] ${p.pattern}`);
  }

  console.log("\n--- File Statistics ---");
  for (const f of analysis.fileStats.sort((a, b) => b.failures - a.failures).slice(0, 10)) {
    console.log(`  ${f.file}: ${f.failures} failures`);
  }

  console.log("\n" + "=".repeat(60) + "\n");
}
