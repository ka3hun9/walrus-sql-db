import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const logicFiles = [
  "test/sqllogic/p1-basic.slt",
  "test/sqllogic/p2-extended.slt",
];

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

for (const file of logicFiles) {
  const out = spawnSync(
    process.execPath,
    [tsxCliPath, "examples/sql-logic-runner.ts", file],
    { encoding: "utf8" },
  );

  assert.equal(
    out.status,
    0,
    [
      `sqllogic runner failed for ${file}`,
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );
}

console.log("ok: H-TEST-005 sqllogic extension set (phase-two syntax)");
