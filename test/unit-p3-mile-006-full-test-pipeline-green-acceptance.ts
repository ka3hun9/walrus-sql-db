import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};

for (const key of [
  "build",
  "test:ci:unit",
  "test:ci:integration",
  "test:ci:regression",
  "test:ci:benchmark",
  "test:ci",
  "ci:full",
]) {
  assert.equal(typeof scripts[key], "string", `missing package script: ${key}`);
}

const ciScript = scripts["test:ci"] ?? "";
for (const part of ["npm run test:ci:unit", "npm run test:ci:integration", "npm run test:ci:regression"]) {
  assert.ok(ciScript.includes(part), `test:ci should include: ${part}`);
}

const fullScript = scripts["ci:full"] ?? "";
for (const part of ["npm run build", "npm run test:ci", "npm run test:ci:benchmark"]) {
  assert.ok(fullScript.includes(part), `ci:full should include: ${part}`);
}

const workflow = readFileSync(".github/workflows/ci-tests.yml", "utf8");
for (const snippet of [
  "name: Build",
  "name: Unit tests",
  "name: Integration tests",
  "name: Regression tests",
  "name: Benchmark gate",
  "run: npm run build",
  "run: npm run test:ci:unit",
  "run: npm run test:ci:integration",
  "run: npm run test:ci:regression",
  "run: npm run test:ci:benchmark",
]) {
  assert.ok(workflow.includes(snippet), `missing workflow gate: ${snippet}`);
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-006\b/.test(checklist), false, "P3-MILE-006 must be checked");

const report = readFileSync("docs/sql-p3-mile-006-full-test-pipeline-green-report.md", "utf8");
for (const snippet of [
  "## P3-MILE-006",
  "build/unit/integration/regression/bench",
  "npm run build",
  "npm run test:ci:unit",
  "npm run test:ci:integration",
  "npm run test:ci:regression",
  "npm run test:ci:benchmark",
  "PASS",
]) {
  assert.ok(report.includes(snippet), `missing report evidence: ${snippet}`);
}

console.log("ok: P3-MILE-006 full test pipeline green acceptance");
