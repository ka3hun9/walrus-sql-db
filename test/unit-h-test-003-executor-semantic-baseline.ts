import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const semanticSuites = [
  "./unit-c-exec-001-full-outer-join.ts",
  "./unit-c-exec-002-predicate-semantics.ts",
  "./unit-c-exec-003-scalar-subquery-cardinality.ts",
  "./unit-c-exec-004-correlated-subquery.ts",
  "./unit-c-exec-005-group-having-aggregate.ts",
  "./unit-c-exec-006-order-limit-stability.ts",
  "./unit-c-exec-007-null-3vl-consistency.ts",
];

for (const suite of semanticSuites) {
  await import(suite);
}

const categories = [
  "compare",
  "null-3vl",
  "like",
  "in-between",
  "subquery",
  "correlated",
  "expr",
  "logic",
  "having",
].join(",");

const reportRoot = mkdtempSync(join(tmpdir(), "walrus-h-test-003-"));
const reportPath = join(reportRoot, "sql-compare-report.json");
const mreDir = join(reportRoot, "mre");
const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

try {
  const out = spawnSync(
    process.execPath,
    [tsxCliPath, "examples/sql-compare-matrix.ts", reportPath, mreDir, "pr", categories],
    { encoding: "utf8" },
  );

  assert.equal(
    out.status,
    0,
    [
      "SQLite differential runner failed for H-TEST-003.",
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );

  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    summary: { total: number; passed: number; failed: number };
  };

  assert.equal(report.summary.failed, 0, "SQLite diff report has failing executor semantic cases");
  assert.equal(report.summary.passed, report.summary.total, "Not all executor semantic diff cases passed");
} finally {
  rmSync(reportRoot, { recursive: true, force: true });
}

console.log("ok: H-TEST-003 executor semantics gate against SQLite baseline");
