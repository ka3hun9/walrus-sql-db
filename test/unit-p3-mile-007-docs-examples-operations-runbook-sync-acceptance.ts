import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

await import("./unit-j-mile-007-docs-examples-regression-sync.ts");

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};

for (const key of ["build", "sql:compare:matrix:category", "sql:semantic:grouped", "sql:logic:all"]) {
  assert.equal(typeof scripts[key], "string", `missing package script: ${key}`);
}

const runbook = readFileSync("docs/sql-p3-operations-runbook.md", "utf8");
for (const snippet of [
  "# P3 Operations Runbook",
  "npm run build",
  "npm run sql:compare:matrix:category",
  "npm run sql:semantic:grouped",
  "npm run sql:logic:all",
  "test/unit-p3-mile-007-docs-examples-operations-runbook-sync-acceptance.ts",
]) {
  assert.ok(runbook.includes(snippet), `missing runbook evidence: ${snippet}`);
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-007\b/.test(checklist), false, "P3-MILE-007 must be checked");

const report = readFileSync("docs/sql-p3-mile-007-docs-examples-operations-runbook-sync-report.md", "utf8");
for (const snippet of [
  "## P3-MILE-007",
  "docs/sql-p3-operations-runbook.md",
  "examples/sql-compare-matrix.ts",
  "test/unit-j-mile-007-docs-examples-regression-sync.ts",
  "PASS",
]) {
  assert.ok(report.includes(snippet), `missing report evidence: ${snippet}`);
}

console.log("ok: P3-MILE-007 docs/examples/ops-runbook sync acceptance");
