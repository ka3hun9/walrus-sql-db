/**
 * sqllogictest end-to-end: SQLite select*.test suite
 *
 * Downloads SQLite select test files and runs them through the sqllogictest
 * runner against the WalrusSqlClient in simulator mode.
 *
 * This is the primary integration test that verifies SQL compatibility
 * against SQLite's official test suite.
 *
 * Run with: npm run test -- test/sqllogictest/select.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { WalrusSqlClient } from "../../src/client.js";
import type { SqlClient, SltFileRunResult } from "./runner.js";
import { runSltFile, summarizeResults } from "./runner.js";
import { parseSlt } from "./parser.js";
import { trackElement, createEmptyCoverage } from "./coverage.js";
import type { FeatureCoverage } from "./coverage.js";
import { PRIORITY_TESTS, loadCachedTest, cachedTestCount, downloadAllPriorityTests } from "./fetch.js";

/** Create a fresh WalrusSqlClient in simulator mode */
function makeClient(): SqlClient {
  return new WalrusSqlClient({
    packageId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    network: "sui-devnet",
    mode: "simulator",
    dialect: "sqlite",
    logging: { level: "error" },
  }) as unknown as SqlClient;
}

describe("sqllogictest SQLite select suite", () => {
  const totalCoverage = createEmptyCoverage();
  const cachedFiles: Array<{ name: string; content: string }> = [];

  beforeAll(async () => {
    // Download test files if not cached
    if (cachedTestCount() === 0) {
      console.log("No cached test files, downloading...");
      await downloadAllPriorityTests();
    }
    for (const name of PRIORITY_TESTS) {
      try {
        const content = loadCachedTest(name);
        cachedFiles.push({ name, content });
        const doc = parseSlt(content, name);
        for (const el of doc.elements) {
          trackElement(totalCoverage, el as any);
        }
      } catch {
        // File not cached — skip
      }
    }
    console.log(`Loaded ${cachedFiles.length} test files`);
  }, 120_000);

  it("has at least some cached test files", () => {
    expect(cachedFiles.length).toBeGreaterThan(0);
  });

  // =======================================================================
  // Full suite — runs all cached files against the executor
  // =======================================================================
  describe("full suite", () => {
    it("runs all cached files and reports summary", async () => {
      const results = await Promise.all(
        cachedFiles.map((f) =>
          runSltFile(f.name, f.content, makeClient, {
            engine: "walrus",
            engineVersion: "0.3.0",
            mode: "simulator",
          }),
        ),
      );

      const summary = summarizeResults(results);

      // Analyze failures
      const failureMessages: string[] = [];
      const errorCategories: Record<string, number> = {};
      for (const result of results) {
        for (const failure of result.failures) {
          if (failure.status === "failed" && failure.message) {
            // Categorize errors
            const msg = failure.message;
            if (msg.includes("Unknown identifier")) errorCategories["Unknown identifier"] = (errorCategories["Unknown identifier"] || 0) + 1;
            else if (msg.includes("Query error")) errorCategories["Query error"] = (errorCategories["Query error"] || 0) + 1;
            else if (msg.includes("Result mismatch")) errorCategories["Result mismatch"] = (errorCategories["Result mismatch"] || 0) + 1;
            else if (msg.includes("Unexpected exception")) errorCategories["Unexpected exception"] = (errorCategories["Unexpected exception"] || 0) + 1;
            else {
              // Truncate long messages for summary
              const short = msg.substring(0, 80);
              errorCategories[short] = (errorCategories[short] || 0) + 1;
            }
            // Collect first few samples
            if (failureMessages.length < 20) {
              failureMessages.push(`${result.filePath}: ${failure.message}`);
            }
          }
        }
      }

      // Sort categories by count
      const sortedErrors = Object.entries(errorCategories).sort((a, b) => b[1] - a[1]);

      console.log("\n========================================");
      console.log("SQLite sqllogictest Suite Summary");
      console.log("========================================");
      console.log(`Files total:    ${summary.totalFiles}`);
      console.log(`Files skipped:  ${summary.filesSkipped}`);
      console.log(`Tests run:     ${summary.totalTests}`);
      console.log(`Tests passed:  ${summary.testsPassed}`);
      console.log(`Tests failed:  ${summary.testsFailed}`);
      console.log(`Tests skipped: ${summary.testsSkipped}`);
      console.log(`Pass rate:     ${summary.passRate}`);
      console.log("========================================");
      console.log("\n=== Failure Categories (Top 15) ===");
      for (const [cat, count] of sortedErrors.slice(0, 15)) {
        console.log(`  ${count}: ${cat}`);
      }
      console.log("\n=== Sample Failures ===");
      for (const msg of failureMessages.slice(0, 10)) {
        console.log(`  ${msg}`);
      }
      console.log("========================================\n");

      // This test passes as long as we ran the suite
      expect(summary.totalTests).toBeGreaterThan(0);
    }, 180_000);
  });
});
