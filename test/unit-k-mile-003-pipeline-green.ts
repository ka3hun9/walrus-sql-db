import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

await import("./unit-j-mile-006-pipeline-manifest-gate.ts");
await import("./unit-k-tval-026-ci-typedvalue-gate.ts");

const report = readFileSync("docs/sql-mile-k-003-pipeline-green-report.md", "utf8");
assert.ok(report.includes("## K-MILE-003"));
assert.ok(report.includes("npm run ci:full"));
assert.ok(report.includes("test:ci:typedvalue"));
assert.ok(report.includes("PASS"));

console.log("ok: K-MILE-003 full pipeline green gate");
