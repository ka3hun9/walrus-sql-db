import { runP3Bench002IndexedSameLoadBenefit, writeP3BenchReport } from "../test/benchmark/p3-benchmarks.js";

const report = await runP3Bench002IndexedSameLoadBenefit();
const outPath = "reports/p3-bench-002-indexed-same-workload-benefit.json";

await writeP3BenchReport(outPath, report);

console.log("p3-bench-002 indexed same-load benefit ok", {
  baselineQps: report.baseline.performance.throughputQps,
  indexedQps: report.indexed.performance.throughputQps,
  baselineP95Ms: report.baseline.performance.p95LatencyMs,
  indexedP95Ms: report.indexed.performance.p95LatencyMs,
  rowsVisitedReductionPct: report.gains.rowsVisitedReductionPct,
  physicalCostReductionPct: report.gains.physicalCostReductionPct,
  outPath,
});
