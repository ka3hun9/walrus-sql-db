import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendP4Boot002TrackingSample,
  runP4Boot002PerformanceBaseline,
  writeP4Boot002PerformanceReport,
} from "./benchmark/p4-boot-002-performance-baseline.js";

type P4Boot002Report = {
  benchmark: string;
  config: {
    windowRows: number;
    windowMeasuredRounds: number;
    recursiveCteProbeRounds: number;
    dynamicSqlProbeRounds: number;
  };
  windowFunction: {
    mode: string;
    resultRows: number;
    performance: {
      operations: number;
      throughputOpsPerSec: number;
      p95LatencyMs: number;
    };
  };
  recursiveCte: {
    expectedErrorCode: string;
    rejected: number;
    observedTokens: string[];
  };
  dynamicSql: {
    expectedErrorCode: string;
    rejected: number;
    observedTokens: string[];
  };
  tracking: {
    reportPath: string;
    historyPath: string;
  };
};

const report = await runP4Boot002PerformanceBaseline({
  windowRows: 1000,
  windowWarmupRounds: 1,
  windowMeasuredRounds: 8,
  recursiveCteProbeRounds: 16,
  dynamicSqlProbeRounds: 16,
});

assert.equal(report.benchmark, "p4-boot-002-performance-baseline");
assert.equal(report.windowFunction.mode, "supported");
assert.ok(report.windowFunction.resultRows > 0);
assert.equal(report.windowFunction.performance.operations, 8);
assert.ok(report.windowFunction.performance.throughputOpsPerSec > 0);
assert.ok(report.windowFunction.performance.p95LatencyMs >= 0);

assert.equal(report.recursiveCte.mode, "expected_error_probe");
assert.equal(report.recursiveCte.expectedErrorCode, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
assert.equal(report.recursiveCte.rejected, 16);
assert.ok(report.recursiveCte.observedTokens.includes("cte"));

assert.equal(report.dynamicSql.mode, "expected_error_probe");
assert.equal(report.dynamicSql.expectedErrorCode, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
assert.equal(report.dynamicSql.rejected, 16);
assert.ok(report.dynamicSql.observedTokens.includes("PREPARE"));
assert.ok(report.dynamicSql.observedTokens.includes("EXECUTE"));

const tempDir = mkdtempSync(join(tmpdir(), "walrus-sql-p4-boot-002-"));
const tempReportPath = join(tempDir, "p4-boot-002-performance-baseline.json");
const tempHistoryPath = join(tempDir, "p4-boot-002-performance-tracking.jsonl");

try {
  const withPaths = {
    ...report,
    tracking: {
      ...report.tracking,
      reportPath: tempReportPath,
      historyPath: tempHistoryPath,
    },
  };

  await writeP4Boot002PerformanceReport(tempReportPath, withPaths);
  await appendP4Boot002TrackingSample(tempHistoryPath, withPaths);
  await appendP4Boot002TrackingSample(tempHistoryPath, withPaths);

  const writtenReport = JSON.parse(readFileSync(tempReportPath, "utf8")) as P4Boot002Report;
  assert.equal(writtenReport.benchmark, "p4-boot-002-performance-baseline");
  assert.equal(writtenReport.config.windowRows, 1000);
  assert.equal(writtenReport.config.windowMeasuredRounds, 8);
  assert.equal(writtenReport.config.recursiveCteProbeRounds, 16);
  assert.equal(writtenReport.config.dynamicSqlProbeRounds, 16);
  assert.equal(writtenReport.windowFunction.mode, "supported");
  assert.equal(writtenReport.recursiveCte.expectedErrorCode, "SQL_DIALECT_UNSUPPORTED_SYNTAX");
  assert.equal(writtenReport.dynamicSql.expectedErrorCode, "SQL_DIALECT_UNSUPPORTED_SYNTAX");

  const historyLines = readFileSync(tempHistoryPath, "utf8").trim().split(/\r?\n/);
  assert.equal(historyLines.length, 2);

  const lastSample = JSON.parse(historyLines[historyLines.length - 1] ?? "{}") as {
    benchmark?: string;
    windowThroughputQps?: number;
    recursiveCteRejectOpsPerSec?: number;
    dynamicSqlRejectOpsPerSec?: number;
  };
  assert.equal(lastSample.benchmark, "p4-boot-002-performance-baseline");
  assert.ok((lastSample.windowThroughputQps ?? 0) > 0);
  assert.ok((lastSample.recursiveCteRejectOpsPerSec ?? 0) > 0);
  assert.ok((lastSample.dynamicSqlRejectOpsPerSec ?? 0) > 0);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-BOOT-002\b/.test(checklist), false, "P4-BOOT-002 must be checked");

const reportDoc = readFileSync("docs/sql-p4-boot-002-performance-baseline.md", "utf8");
assert.ok(reportDoc.includes("## P4-BOOT-002"));
assert.ok(reportDoc.includes("window"));
assert.ok(reportDoc.includes("recursive CTE"));
assert.ok(reportDoc.includes("dynamic SQL"));
assert.ok(reportDoc.includes("reports/p4-boot-002-performance-baseline.json"));
assert.ok(reportDoc.includes("reports/p4-boot-002-performance-tracking.jsonl"));

console.log("ok: P4-BOOT-002 performance baseline bootstrap (window + recursive CTE + dynamic SQL tracking)");
