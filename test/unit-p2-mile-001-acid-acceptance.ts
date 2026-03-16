import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const suite = [
  "test/unit-c-exec-010-transaction-atomic-commit.ts",
  "test/unit-c-exec-013-read-committed-view.ts",
  "test/unit-c-exec-011-transaction-rollback-consistency.ts",
  "test/unit-p2-exe-002-commit-revalidation.ts",
  "test/unit-g-stor-013-crash-recovery-wal-version-chain.ts",
];

for (const file of suite) {
  const out = spawnSync(process.execPath, [tsxCliPath, file], { encoding: "utf8" });
  assert.equal(
    out.status,
    0,
    [
      `P2-MILE-001 suite failed for ${file}`,
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );
}

console.log("ok: P2-MILE-001 ACID acceptance suite");
