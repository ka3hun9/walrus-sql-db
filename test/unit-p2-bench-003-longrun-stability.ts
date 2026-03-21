import { strict as assert } from "node:assert";
import { runP2LongRunStability } from "../test/benchmark/p2-benchmarks.js";

const report = await runP2LongRunStability({ durationMs: 3_000, writeEveryMs: 10 });

assert.equal(report.samples.length, 1);
const sample = report.samples[0]!;
assert.equal(sample.name, "p2_long_run_stability");
assert.ok(sample.operations > 10);
assert.ok(sample.durationMs >= 2500);
assert.ok(sample.opsPerSec > 0);

const notes = report.notes ?? [];
const checks = Number((notes.find((n) => n.startsWith("consistency_checks=")) ?? "consistency_checks=0").split("=")[1]);
const errors = Number((notes.find((n) => n.startsWith("errors=")) ?? "errors=999").split("=")[1]);
assert.ok(checks >= 1);
assert.equal(errors, 0);

console.log("ok: P2-BENCH-003 long-run stability benchmark");
