import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

await import("./unit-k-mile-001-no-primitive-shortcuts.ts");
await import("./unit-k-tval-026-ci-typedvalue-gate.ts");

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] K-TVAL-\d+/.test(checklist), false, "K-TVAL checklist must be fully checked");
assert.equal(/- \[ \] K-MILE-001/.test(checklist), false, "K-MILE-001 must be checked");
assert.equal(/- \[ \] K-MILE-002/.test(checklist), false, "K-MILE-002 must be checked");

const report = readFileSync("docs/sql-mile-k-002-atype001-typedvalue-acceptance-report.md", "utf8");
assert.ok(report.includes("## K-MILE-002"));
assert.ok(report.includes("A-TYPE-001"));
assert.ok(report.includes("K-TVAL-001"));
assert.ok(report.includes("K-TVAL-026"));
assert.ok(report.includes("PASS"));

console.log("ok: K-MILE-002 A-TYPE-001 full-chain TypedValue acceptance gate");
