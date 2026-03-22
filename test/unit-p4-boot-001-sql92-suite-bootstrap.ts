import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SuiteReport = {
  summary: {
    suiteId: string;
    entryCount: number;
    failedEntries: number;
    failedCases: number;
    totalCases: number;
    passedCases: number;
  };
  results: Array<{
    id: string;
    focus: string[];
    status: "passed" | "failed";
    total: number;
    passed: number;
  }>;
};

const manifestPath = "test/sqllogic/suites/p4-boot-001-minimal.json";
const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const tempDir = mkdtempSync(join(tmpdir(), "walrus-sql-p4-boot-001-"));
const tempReportPath = join(tempDir, "sql92-p4-boot-001-minimal.json");

try {
  const out = spawnSync(
    process.execPath,
    [tsxCliPath, "examples/sql-logic-suite-runner.ts", manifestPath, tempReportPath],
    { encoding: "utf8" },
  );

  assert.equal(
    out.status,
    0,
    [
      "P4-BOOT-001 suite runner should pass",
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );

  const report = JSON.parse(readFileSync(tempReportPath, "utf8")) as SuiteReport;
  assert.equal(report.summary.suiteId, "p4-boot-001-sql92-minimal");
  assert.equal(report.summary.entryCount, 2);
  assert.equal(report.summary.failedEntries, 0);
  assert.equal(report.summary.failedCases, 0);
  assert.ok(report.summary.totalCases >= 6);
  assert.equal(report.summary.passedCases, report.summary.totalCases);

  const byId = new Map(report.results.map((item) => [item.id, item]));
  const windowEntry = byId.get("window-row-number-core");
  const cteEntry = byId.get("cte-baseline-boundary");

  assert.ok(windowEntry, "window entry must exist");
  assert.ok(cteEntry, "cte entry must exist");
  assert.equal(windowEntry?.status, "passed");
  assert.equal(cteEntry?.status, "passed");
  assert.ok(windowEntry?.focus.includes("window"));
  assert.ok(cteEntry?.focus.includes("cte"));
  assert.ok((windowEntry?.total ?? 0) >= 2);
  assert.ok((cteEntry?.total ?? 0) >= 2);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P4-BOOT-001\b/.test(checklist), false, "P4-BOOT-001 must be checked");

const reportDoc = readFileSync("docs/sql-p4-boot-001-sql92-suite-bootstrap.md", "utf8");
assert.ok(reportDoc.includes("## P4-BOOT-001"));
assert.ok(reportDoc.includes("sql:logic:suite"));
assert.ok(reportDoc.includes("reports/sql92-p4-boot-001-minimal.json"));
assert.ok(reportDoc.includes("window"));
assert.ok(reportDoc.includes("CTE"));

console.log("ok: P4-BOOT-001 SQL-92 suite bootstrap (window+cte minimal subset)");
