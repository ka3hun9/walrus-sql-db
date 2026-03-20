import { strict as assert } from "node:assert";
import { runP3Bench002IndexedSameLoadBenefit, writeP3BenchReport } from "../src/p3-benchmarks.js";

const report = await runP3Bench002IndexedSameLoadBenefit({
  customers: 900,
  ordersPerCustomer: 12,
  paidEveryNOrders: 7,
  customerRangeStart: 120,
  customerRangeEnd: 520,
  warmupRounds: 2,
  measuredRounds: 12,
});

assert.equal(report.benchmark, "p3-bench-002-indexed-same-load-benefit");
assert.equal(report.baseline.explain.physicalOptimizerAccessPath, "TABLE_SCAN");
assert.equal(report.baseline.explain.physicalOptimizerIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(report.baseline.explain.physicalAccessPath, "TABLE_SCAN");
assert.equal(report.baseline.explain.physicalIndexStrategy, "FULL_TABLE_SCAN");

assert.equal(report.baseline.execution.resultRows, report.indexed.execution.resultRows);
assert.ok(report.baseline.execution.resultRows > 0);
assert.ok(report.baseline.performance.throughputQps > 0);
assert.ok(report.indexed.performance.throughputQps > 0);
assert.ok(report.baseline.performance.p95LatencyMs > 0);
assert.ok(report.indexed.performance.p95LatencyMs > 0);

assert.notEqual(report.indexed.explain.physicalAccessPath, "TABLE_SCAN");
assert.notEqual(report.indexed.explain.physicalIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(report.baseline.observability.lookupCountTotal, 0);
assert.equal(report.baseline.observability.indexObservabilityEntries, 0);
assert.ok(report.indexed.observability.indexObservabilityEntries >= 1);
assert.ok(report.indexed.observability.lookupCountTotal > 0);
assert.ok(report.indexed.observability.lookupHitsTotal > 0);

assert.ok(report.gains.rowsVisitedPerQueryDelta > 0);
assert.ok(report.gains.rowsVisitedReductionPct > 60);
assert.ok(report.gains.physicalCostDelta > 0);
assert.ok(report.gains.physicalCostReductionPct > 0);
assert.ok(report.gains.throughputQpsDelta > 0);
assert.ok(report.gains.p95LatencyMsDelta > 0);

const outPath = "reports/p3-bench-002-indexed-same-workload-benefit.json";
await writeP3BenchReport(outPath, report);

console.log(`ok: integration P3-BENCH-002 indexed same-load benefit -> ${outPath}`);
