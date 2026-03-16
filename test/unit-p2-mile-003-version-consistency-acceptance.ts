import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const suite = [
  "test/unit-g-stor-011-immutable-version-object-on-commit.ts",
  "test/unit-g-stor-012-version-chain-metadata.ts",
  "test/unit-g-stor-013-crash-recovery-wal-version-chain.ts",
  "test/unit-g-stor-014-query-latest-committed-version.ts",
  "test/unit-g-stor-015-pending-confirmed-read-strategy.ts",
];

for (const file of suite) {
  const out = spawnSync(process.execPath, [tsxCliPath, file], { encoding: "utf8" });
  assert.equal(
    out.status,
    0,
    [
      `P2-MILE-003 suite failed for ${file}`,
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );
}

console.log("ok: P2-MILE-003 walrus version-consistency acceptance");
