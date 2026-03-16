import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const suite = [
  "test/unit-e-ddl-005-foreign-key-parse-levels.ts",
  "test/unit-f-fk-002-catalog-metadata.ts",
  "test/unit-f-fk-003-insert-update-integrity.ts",
  "test/unit-f-fk-004-on-delete-cascade.ts",
  "test/unit-f-fk-005-on-delete-restrict-no-action.ts",
  "test/unit-f-fk-006-on-update-cascade-restrict.ts",
  "test/unit-f-fk-007-cycle-depth-protection.ts",
];

for (const file of suite) {
  const out = spawnSync(process.execPath, [tsxCliPath, file], { encoding: "utf8" });
  assert.equal(
    out.status,
    0,
    [
      `P2-MILE-002 suite failed for ${file}`,
      `stdout:\n${out.stdout ?? ""}`,
      `stderr:\n${out.stderr ?? ""}`,
    ].join("\n"),
  );
}

console.log("ok: P2-MILE-002 FK full-path acceptance");
