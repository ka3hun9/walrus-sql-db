import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const docPath = "docs/sql-mile-007-docs-examples-regression-sync.md";
const doc = readFileSync(docPath, "utf8");
for (const snippet of [
  "## J-MILE-007",
  "examples/sql-compare-matrix.ts",
  "examples/sql-semantic-grouped-runner.ts",
  "docs/sql-p3-operations-runbook.md",
  "npm run sql:compare:matrix:category",
  "npm run sql:semantic:grouped",
  "PASS",
]) {
  assert.ok(doc.includes(snippet), `missing doc snippet: ${snippet}`);
}

for (const file of [
  "examples/sql-compare-matrix.ts",
  "examples/sql-semantic-grouped-runner.ts",
  "examples/sql-logic-runner.ts",
  "docs/sql-p3-operations-runbook.md",
  "test/sqllogic/p1-basic.slt",
  "test/sqllogic/p2-extended.slt",
]) {
  assert.equal(existsSync(file), true, `missing sync artifact: ${file}`);
}

const runbook = readFileSync("docs/sql-p3-operations-runbook.md", "utf8");
for (const snippet of [
  "# P3 Operations Runbook",
  "npm run sql:compare:matrix:category",
  "npm run sql:semantic:grouped",
  "npm run sql:logic:all",
]) {
  assert.ok(runbook.includes(snippet), `missing runbook snippet: ${snippet}`);
}

const tmpRoot = mkdtempSync(join(tmpdir(), "walrus-j-mile-007-"));
const reportPath = join(tmpRoot, "sql-compare-report.json");
const mreDir = join(tmpRoot, "mre");
const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

try {
  const out = spawnSync(
    process.execPath,
    [tsxCliPath, "examples/sql-compare-matrix.ts", reportPath, mreDir, "pr"],
    { encoding: "utf8" },
  );

  assert.equal(
    out.status,
    0,
    [
      "sql-compare-matrix snapshot run failed",
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );

  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    summary?: { total?: number; failed?: number };
  };
  assert.ok((report.summary?.total ?? 0) > 0, "snapshot report should include cases");
  assert.equal(report.summary?.failed ?? 1, 0, "snapshot report has mismatches");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("ok: J-MILE-007 docs/examples/regression snapshot sync gate");
