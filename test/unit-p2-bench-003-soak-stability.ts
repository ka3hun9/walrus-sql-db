import { strict as assert } from "node:assert";
import { runTpccLikeLongRunStability } from "./benchmark/p2-benchmarks.js";

const report = await runTpccLikeLongRunStability({ durationMs: 1_200, writeEveryMs: 10 });

assert.equal(report.samples.length, 1);
const sample = report.samples[0]!;
assert.equal(sample.name, "p2_long_run_stability");
assert.ok(sample.operations > 0);
assert.ok(sample.durationMs >= 1_000);
assert.ok(sample.opsPerSec > 0);

const notes = report.notes ?? [];
const checks = Number((notes.find((n) => n.startsWith("consistency_checks=")) ?? "consistency_checks=0").split("=")[1]);
const errors = Number((notes.find((n) => n.startsWith("errors=")) ?? "errors=999").split("=")[1]);
assert.ok(checks >= 1);
assert.equal(errors, 0);

console.log("ok: P2-BENCH-003 soak stability runner reports no consistency errors");
