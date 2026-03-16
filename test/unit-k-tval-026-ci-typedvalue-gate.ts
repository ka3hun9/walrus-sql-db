import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};

assert.equal(typeof scripts["test:ci:typedvalue"], "string", "missing package script: test:ci:typedvalue");
assert.ok(
  scripts["test:ci:typedvalue"]!.includes("scripts/run-typedvalue-tests.ts"),
  "test:ci:typedvalue should invoke scripts/run-typedvalue-tests.ts",
);
assert.equal(typeof scripts["ci:full"], "string", "missing package script: ci:full");
assert.ok(
  scripts["ci:full"]!.includes("test:ci:typedvalue"),
  "ci:full should include typedvalue gate",
);

const runner = readFileSync("scripts/run-typedvalue-tests.ts", "utf8");
assert.ok(runner.includes("unit-k-tval-"), "typedvalue runner should select unit-k-tval-* files");
assert.ok(runner.includes("unit-k-mile-"), "typedvalue runner should select unit-k-mile-* files");

console.log("ok: K-TVAL-026 typedvalue ci gate is wired into ci:full");
