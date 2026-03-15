import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const suites = [
  "./unit-f-const-001-primary-key-index-maintenance.ts",
  "./unit-f-const-002-unique-collision-detection.ts",
  "./unit-f-const-003-not-null-ddl-dml.ts",
  "./unit-f-const-004-constraint-error-codes.ts",
  "./unit-f-const-005-error-layering-stability.ts",
  "./unit-f-const-006-error-context.ts",
];

for (const suite of suites) {
  await import(suite);
}

const report = readFileSync("docs/sql-mile-005-constraint-error-acceptance-report.md", "utf8");
assert.ok(report.includes("## J-MILE-005"));
assert.ok(report.includes("unit-f-const-001"));
assert.ok(report.includes("unit-f-const-006"));
assert.ok(report.includes("PASS"));

console.log("ok: J-MILE-005 constraint/error acceptance report gate");
