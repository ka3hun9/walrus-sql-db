import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  runP3Bench001NoIndexComplexBaseline,
  runP3Bench002IndexedSameLoadBenefit,
  runP3Bench003CboBenefitVsFixedRuleBaseline,
  runP3Bench004LargeDatasetComplexJoinSubqueryStress,
} from "../test/benchmark/p3-benchmarks.js";

type P3Test007Report = {
  benchmark: string;
  dataset: {
    totalRows: number;
    expectedMatchedRows: number;
  };
  baseline: {
    lastRowsVisited: number;
  };
  indexed: {
    lastRowsVisited: number;
  };
  derived: {
    scanReductionRatio: number;
    latencySpeedupRatio: number;
  };
};

type P3Test008Report = {
  benchmark: string;
  config: {
    thresholds: {
      minWrites: number;
      minWindowSize: number;
      minWritesPerSec: number;
      degradationRatioMax: number;
    };
  };
  consistency: {
    writes: number;
    errors: number;
  };
  performance: {
    samples: number;
    writesPerSec: number;
    degradationRatio: number;
  };
  subquery: {
    correlatedExecutions: number;
  };
};

function readJsonReport<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

await import("./integration-p3-test-008-longrun-stability-consistency-performance-threshold.ts");
await import("./integration-p3-test-007-million-row-index-acceleration-pressure.ts");

const test007 = readJsonReport<P3Test007Report>("reports/p3-test-007-million-row-index-acceleration-bench.json");
assert.equal(test007.benchmark, "p3-test-007-million-row-index-acceleration-pressure");
assert.equal(test007.baseline.lastRowsVisited, test007.dataset.totalRows);
assert.equal(test007.indexed.lastRowsVisited, test007.dataset.expectedMatchedRows);
assert.ok(test007.derived.scanReductionRatio >= 10_000);
assert.ok(test007.derived.latencySpeedupRatio > 0);

const test008 = readJsonReport<P3Test008Report>("reports/p3-test-008-longrun-stability-report.json");
assert.equal(test008.benchmark, "p3-test-008-longrun-stability-consistency-performance-threshold");
assert.equal(test008.consistency.errors, 0);
assert.ok(test008.consistency.writes >= test008.config.thresholds.minWrites);
assert.ok(test008.performance.samples >= test008.config.thresholds.minWindowSize * 2);
assert.ok(test008.performance.writesPerSec >= test008.config.thresholds.minWritesPerSec);
assert.ok(test008.performance.degradationRatio <= test008.config.thresholds.degradationRatioMax);
assert.ok(test008.subquery.correlatedExecutions > 0);

const bench001 = await runP3Bench001NoIndexComplexBaseline({
  customers: 600,
  ordersPerCustomer: 10,
  refundEveryNOrders: 5,
  warmupRounds: 3,
  measuredRounds: 12,
});
assert.equal(bench001.benchmark, "p3-bench-001-no-index-complex-query-baseline");
assert.equal(bench001.query.explain.physicalAccessPath, "TABLE_SCAN");
assert.equal(bench001.noIndexEvidence.noIndexObserved, true);
assert.ok(bench001.performance.throughputQps > 0);
assert.ok(bench001.execution.rowsVisitedPerQuery >= bench001.execution.resultRows);

const bench002 = await runP3Bench002IndexedSameLoadBenefit({
  customers: 900,
  ordersPerCustomer: 12,
  paidEveryNOrders: 7,
  customerRangeStart: 120,
  customerRangeEnd: 520,
  warmupRounds: 2,
  measuredRounds: 12,
});
assert.equal(bench002.benchmark, "p3-bench-002-indexed-same-load-benefit");
assert.ok(bench002.gains.rowsVisitedReductionPct > 60);
assert.ok(bench002.gains.physicalCostReductionPct > 0);
assert.ok(bench002.gains.throughputQpsDelta > 0);
assert.ok(bench002.gains.p95LatencyMsDelta > 0);

const bench003 = await runP3Bench003CboBenefitVsFixedRuleBaseline({
  rows: 18000,
  scoreModulo: 4000,
  scoreWindowStart: 900,
  scoreWindowWidth: 2,
  warmupRounds: 2,
  measuredRounds: 12,
});
assert.equal(bench003.benchmark, "p3-bench-003-cbo-benefit-vs-fixed-rule-baseline");
assert.equal(bench003.verdict.cboPreferred, true);
assert.ok(bench003.gains.rowsVisitedReductionPct > 80);
assert.ok(bench003.gains.physicalCostReductionPct > 50);

const bench004 = await runP3Bench004LargeDatasetComplexJoinSubqueryStress({
  customers: 1400,
  ordersPerCustomer: 16,
  shipmentDeliveredEveryNOrders: 2,
  refundEveryNOrders: 6,
  warmupRounds: 2,
  measuredRounds: 8,
  joinMemoryBudgetRows: 180000,
  joinSpillChunkRows: 4096,
});
assert.equal(bench004.benchmark, "p3-bench-004-large-dataset-complex-join-subquery-stress");
assert.ok(bench004.dataset.orders >= 20_000);
assert.equal(bench004.verdict.largeDataset, true);
assert.equal(bench004.verdict.complexJoinObserved, true);
assert.equal(bench004.verdict.complexSubqueryObserved, true);
assert.equal(bench004.verdict.stableResultRows, true);
assert.ok(bench004.joinStress.performance.throughputQps > 0);
assert.ok(bench004.subqueryStress.performance.throughputQps > 0);

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-005\b/.test(checklist), false, "P3-MILE-005 must be checked");

const report = readFileSync("docs/sql-p3-mile-005-large-dataset-performance-stability-acceptance-report.md", "utf8");
assert.ok(report.includes("## P3-MILE-005"));
assert.ok(report.includes("P3-BENCH-004"));
assert.ok(report.includes("P3-TEST-008"));
assert.ok(report.includes("PASS"));

console.log("ok: P3-MILE-005 large-dataset complex-query performance/stability acceptance");
