import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const report = readFileSync("docs/sql-mile-p2-006-docs-example-ops-sync.md", "utf8");
for (const snippet of [
  "## P2-MILE-006",
  "docs/sql-transaction-consistency-ops-manual.md",
  "examples/sql-p2-transaction-consistency.ts",
  "npm run -s sql:p2:txn:consistency",
  "PASS",
]) {
  assert.ok(report.includes(snippet), `missing report snippet: ${snippet}`);
}

const manual = readFileSync("docs/sql-transaction-consistency-ops-manual.md", "utf8");
for (const snippet of [
  "READ COMMITTED",
  "getTransactionObservabilityStats()",
  "recoverPendingTransactionLogsFromWal()",
  "recoverConsistentStateFromWalAndVersionChain",
  "checkpointWal()",
  "ERR_CONSTRAINT_VIOLATION:WRITE_CONFLICT",
  "ERR_UNSUPPORTED_DDL",
]) {
  assert.ok(manual.includes(snippet), `missing ops-manual snippet: ${snippet}`);
}

for (const file of [
  "docs/sql-transaction-consistency-ops-manual.md",
  "docs/sql-mile-p2-006-docs-example-ops-sync.md",
  "examples/sql-p2-transaction-consistency.ts",
]) {
  assert.equal(existsSync(file), true, `missing sync artifact: ${file}`);
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.ok(checklist.includes("- [x] P2-MILE-006"), "roadmap checklist should mark P2-MILE-006 as done");

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const out = spawnSync(process.execPath, [tsxCliPath, "examples/sql-p2-transaction-consistency.ts"], { encoding: "utf8" });
assert.equal(
  out.status,
  0,
  [
    "p2 transaction consistency example failed",
    `stdout:\n${out.stdout ?? ""}`,
    `stderr:\n${out.stderr ?? ""}`,
  ].join("\n"),
);
assert.ok((out.stdout ?? "").includes("sql-p2-transaction-consistency ok"), "example should print success marker");

console.log("ok: P2-MILE-006 docs/example/ops sync gate");
