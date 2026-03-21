import { strict as assert } from "node:assert";
import {
  runP3Bench004LargeDatasetComplexJoinSubqueryStress,
  writeP3BenchReport,
} from "../test/benchmark/p3-benchmarks.js";

const report = await runP3Bench004LargeDatasetComplexJoinSubqueryStress({
  customers: 1400,
  ordersPerCustomer: 16,
  shipmentDeliveredEveryNOrders: 2,
  refundEveryNOrders: 6,
  warmupRounds: 2,
  measuredRounds: 8,
  joinMemoryBudgetRows: 180000,
  joinSpillChunkRows: 4096,
});

assert.equal(report.benchmark, "p3-bench-004-large-dataset-complex-join-subquery-stress");
assert.equal(report.dataset.orders, report.config.customers * report.config.ordersPerCustomer);

assert.ok(report.joinStress.explain.physicalJoinCount >= 2);
assert.ok(report.joinStress.explain.physicalJoinAlgorithms.length > 0);
assert.ok(report.joinStress.execution.resultRows > 0);
assert.ok(report.joinStress.execution.rowsVisited > 0);
assert.ok(report.joinStress.performance.throughputQps > 0);

assert.ok(report.subqueryStress.execution.resultRows > 0);
assert.ok(report.subqueryStress.execution.rowsVisited > 0);
assert.ok(report.subqueryStress.performance.throughputQps > 0);
assert.ok((report.subqueryStress.subquery?.entries ?? 0) >= 3);
assert.ok((report.subqueryStress.subquery?.executions ?? 0) > 0);
assert.ok((report.subqueryStress.subquery?.correlatedExecutions ?? 0) > 0);
assert.ok((report.subqueryStress.subquery?.rowsScanned ?? 0) > 0);

assert.ok(report.verdict.largeDataset);
assert.ok(report.verdict.complexJoinObserved);
assert.ok(report.verdict.complexSubqueryObserved);
assert.ok(report.verdict.stableResultRows);
assert.ok(report.verdict.reasons.length >= 3);

const outPath = "reports/p3-bench-004-large-dataset-complex-join-subquery-stress.json";
await writeP3BenchReport(outPath, report);

console.log(`ok: integration P3-BENCH-004 large-dataset complex join/subquery stress -> ${outPath}`);
