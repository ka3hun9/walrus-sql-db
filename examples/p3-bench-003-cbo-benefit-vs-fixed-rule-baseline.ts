import { runP3Bench003CboBenefitVsFixedRuleBaseline, writeP3BenchReport } from "../src/p3-benchmarks.js";

const report = await runP3Bench003CboBenefitVsFixedRuleBaseline();
const outPath = "reports/p3-bench-003-cbo-benefit-vs-fixed-rule-baseline.json";

await writeP3BenchReport(outPath, report);

console.log("p3-bench-003 cbo benefit vs fixed-rule baseline ok", {
  fixedRulePath: report.fixedRuleBaseline.explain.physicalAccessPath,
  cboPath: report.cbo.explain.physicalAccessPath,
  rowsVisitedReductionPct: report.gains.rowsVisitedReductionPct,
  physicalCostReductionPct: report.gains.physicalCostReductionPct,
  verdict: report.verdict.cboPreferred,
  outPath,
});
