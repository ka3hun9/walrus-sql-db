import { strict as assert } from "node:assert";
import { runTpccLikeSoakBenchmark } from "../test/benchmark/p2-benchmarks.js";

const report = await runTpccLikeSoakBenchmark({
  durationMs: 1_200,
  runConfig: {
    warehouses: 1,
    customersPerWarehouse: 20,
    transactions: 30,
    conflictEvery: 3,
    amountStep: 2,
  },
});

assert.ok(report.runs >= 1);
assert.ok(report.totalAttempted > 0);
assert.ok(report.totalCommitted > 0);
assert.equal(report.consistencyErrors.length, 0);

console.log("ok: P2-BENCH-003 soak stability runner reports no consistency errors");
