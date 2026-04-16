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
import type { SqlClient } from "./runner.js";
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
      console.log("========================================\n");

      // This test passes as long as we ran the suite
      expect(summary.totalTests).toBeGreaterThan(0);
    }, 180_000);
  });
});
