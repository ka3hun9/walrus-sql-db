import { strict as assert } from "node:assert";
import { runTpccLikeConflictBenchmark } from "./benchmark/p2-benchmarks.js";

const report = await runTpccLikeConflictBenchmark({ rounds: 12 });

assert.equal(report.samples.length, 1);
const sample = report.samples[0]!;
assert.equal(sample.name, "p2_tx_conflict_commit");
assert.ok(sample.operations === 24);
assert.ok(sample.durationMs >= 0);
assert.ok(sample.opsPerSec >= 0);
assert.ok((sample.avgLatencyMs ?? 0) >= 0);
assert.ok((sample.conflicts ?? 0) >= 1);

const notes = report.notes ?? [];
assert.ok(notes.some((n) => n === "rounds=12"));
assert.ok(notes.some((n) => n.startsWith("conflicts=")));

console.log("ok: P2-BENCH-002 conflict throughput/latency benchmark");
