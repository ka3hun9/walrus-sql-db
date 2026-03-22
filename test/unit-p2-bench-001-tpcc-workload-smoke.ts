import { strict as assert } from "node:assert";
import { runTpccLikeMiniBenchmark } from "./benchmark/p2-benchmarks.js";

const report = await runTpccLikeMiniBenchmark({
  warehouses: 1,
  districtsPerWarehouse: 1,
  customersPerDistrict: 30,
  ordersPerDistrict: 40,
  linesPerOrder: 2,
});

assert.equal(report.samples.length, 1);
const sample = report.samples[0]!;
assert.equal(sample.name, "p2_tpcc_mini_new_order");
assert.ok(sample.operations > 0);
assert.ok(sample.durationMs >= 0);
assert.ok(sample.opsPerSec >= 0);
assert.ok((sample.avgLatencyMs ?? 0) >= 0);

const notes = report.notes ?? [];
assert.ok(notes.some((n) => n.startsWith("orders=")));
assert.ok(notes.some((n) => n.startsWith("order_lines=")));
assert.ok(notes.some((n) => n.startsWith("expected_order_lines=")));

console.log("ok: P2-BENCH-001 tpcc-like workload is runnable and deterministic");
