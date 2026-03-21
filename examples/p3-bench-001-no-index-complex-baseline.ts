import { runP3Bench001NoIndexComplexBaseline, writeP3BenchReport } from "../test/benchmark/p3-benchmarks.js";

const report = await runP3Bench001NoIndexComplexBaseline();
const outPath = "reports/p3-bench-001-no-index-complex-baseline.json";

await writeP3BenchReport(outPath, report);

console.log("p3-bench-001 no-index complex baseline ok", {
  throughputQps: report.performance.throughputQps,
  p95LatencyMs: report.performance.p95LatencyMs,
  rowsVisitedPerQuery: report.execution.rowsVisitedPerQuery,
  outPath,
});
