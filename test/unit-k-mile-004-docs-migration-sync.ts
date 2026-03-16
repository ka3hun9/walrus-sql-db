import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const report = readFileSync("docs/sql-mile-k-004-docs-migration-sync.md", "utf8");
for (const snippet of [
  "## K-MILE-004",
  "docs/sql-typedvalue-migration-guide.md",
  "examples/sql-typedvalue-migration.ts",
  "npm run sql:typedvalue:migration",
  "PASS",
]) {
  assert.ok(report.includes(snippet), `missing report snippet: ${snippet}`);
}

const guide = readFileSync("docs/sql-typedvalue-migration-guide.md", "utf8");
for (const snippet of [
  "TypedValue Migration Guide",
  "typedValueComparator",
  "typedValueOperators",
  "convertTypedValue",
  "npm run test:ci:typedvalue",
]) {
  assert.ok(guide.includes(snippet), `missing migration-guide snippet: ${snippet}`);
}

for (const file of [
  "docs/sql-typedvalue-migration-guide.md",
  "docs/sql-mile-k-004-docs-migration-sync.md",
  "examples/sql-typedvalue-migration.ts",
]) {
  assert.equal(existsSync(file), true, `missing sync artifact: ${file}`);
}

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const out = spawnSync(process.execPath, [tsxCliPath, "examples/sql-typedvalue-migration.ts"], { encoding: "utf8" });
assert.equal(
  out.status,
  0,
  [
    "typedvalue migration example failed",
    `stdout:\n${out.stdout ?? ""}`,
    `stderr:\n${out.stderr ?? ""}`,
  ].join("\n"),
);
assert.ok((out.stdout ?? "").includes("sql-typedvalue-migration ok"), "migration example should print success marker");

console.log("ok: K-MILE-004 docs/examples/migration sync gate");
