import {
  runP3Bench004LargeDatasetComplexJoinSubqueryStress,
  writeP3BenchReport,
} from "../src/p3-benchmarks.js";

const report = await runP3Bench004LargeDatasetComplexJoinSubqueryStress();
const outPath = "reports/p3-bench-004-large-dataset-complex-join-subquery-stress.json";

await writeP3BenchReport(outPath, report);

console.log("p3-bench-004 large-dataset complex join/subquery stress ok", {
  joinQps: report.joinStress.performance.throughputQps,
  subqueryQps: report.subqueryStress.performance.throughputQps,
  joinP95Ms: report.joinStress.performance.p95LatencyMs,
  subqueryP95Ms: report.subqueryStress.performance.p95LatencyMs,
  complexJoinObserved: report.verdict.complexJoinObserved,
  complexSubqueryObserved: report.verdict.complexSubqueryObserved,
  outPath,
});
