import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const suite = [
  "test/unit-p2-bench-001-tpcc-workload-smoke.ts",
  "test/unit-p2-bench-002-conflict-baseline-report.ts",
  "test/unit-p2-bench-003-soak-stability.ts",
];

for (const file of suite) {
  const out = spawnSync(process.execPath, [tsxCliPath, file], { encoding: "utf8" });
  assert.equal(
    out.status,
    0,
    [
      `P2-MILE-004 suite failed for ${file}`,
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );
}

console.log("ok: P2-MILE-004 tpcc-like benchmark acceptance");
