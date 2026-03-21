import { strict as assert } from "node:assert";
import { runP3Bench001NoIndexComplexBaseline, writeP3BenchReport } from "../test/benchmark/p3-benchmarks.js";

const report = await runP3Bench001NoIndexComplexBaseline({
  customers: 600,
  ordersPerCustomer: 10,
  refundEveryNOrders: 5,
  warmupRounds: 3,
  measuredRounds: 12,
});

assert.equal(report.benchmark, "p3-bench-001-no-index-complex-query-baseline");
assert.equal(report.query.explain.physicalOptimizerAccessPath, "TABLE_SCAN");
assert.equal(report.query.explain.physicalOptimizerIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(report.query.explain.physicalAccessPath, "TABLE_SCAN");
assert.equal(report.query.explain.physicalIndexStrategy, "FULL_TABLE_SCAN");

assert.ok(report.performance.throughputQps > 0);
assert.ok(report.performance.avgLatencyMs >= report.performance.minLatencyMs);
assert.ok(report.performance.p95LatencyMs >= report.performance.p50LatencyMs);
assert.ok(report.performance.p99LatencyMs >= report.performance.p95LatencyMs);

assert.ok(report.execution.resultRows > 0);
assert.ok(report.execution.rowsVisited > 0);
assert.ok(report.execution.rowsVisitedPerQuery >= report.execution.resultRows);
assert.equal(report.noIndexEvidence.noIndexObserved, true);
assert.equal(report.noIndexEvidence.lookupCountTotal, 0);
assert.equal(report.noIndexEvidence.maintenanceRowsTotal, 0);

const outPath = "reports/p3-bench-001-no-index-complex-baseline.json";
await writeP3BenchReport(outPath, report);

console.log(`ok: integration P3-BENCH-001 no-index complex-query baseline -> ${outPath}`);
