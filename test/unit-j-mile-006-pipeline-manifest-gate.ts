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

const workflow = readFileSync(".github/workflows/ci-tests.yml", "utf8");
for (const snippet of [
  "name: Build",
  "name: Unit tests",
  "name: Integration tests",
  "name: Regression tests",
  "name: Benchmark gate",
]) {
  assert.ok(workflow.includes(snippet), `missing workflow step: ${snippet}`);
}

const report = readFileSync("docs/sql-mile-006-pipeline-green-report.md", "utf8");
assert.ok(report.includes("## J-MILE-006"));
assert.ok(report.includes("npm run ci:full"));
assert.ok(report.includes("PASS"));

console.log("ok: J-MILE-006 pipeline manifest gate");
