import { strict as assert } from "node:assert";
import { runTpccLikeBenchmark } from "../test/benchmark/p2-benchmarks.js";

const report = await runTpccLikeBenchmark({
  warehouses: 1,
  customersPerWarehouse: 30,
  transactions: 40,
  conflictEvery: 0,
  amountStep: 3,
});

assert.equal(report.attemptedTransactions, 40);
assert.equal(report.committedTransactions, 40);
assert.equal(report.abortedTransactions, 0);
assert.equal(report.consistencyErrors.length, 0);
assert.ok(report.throughputTps > 0);
assert.ok(report.latencyMs.max >= report.latencyMs.avg);

console.log("ok: P2-BENCH-001 tpcc-like workload is runnable and deterministic");
