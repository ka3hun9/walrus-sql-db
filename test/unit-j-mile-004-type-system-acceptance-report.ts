import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

await import("./unit-h-test-001-type-full-matrix.ts");

const report = readFileSync("docs/sql-mile-004-type-system-acceptance-report.md", "utf8");
assert.ok(report.includes("## J-MILE-004"));
assert.ok(report.includes("A-TYPE-001"));
assert.ok(report.includes("A-TYPE-017"));
assert.ok(report.includes("PASS"));

console.log("ok: J-MILE-004 type-system acceptance report gate");
