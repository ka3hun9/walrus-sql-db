import { strict as assert } from "node:assert";
import { runP3Bench003CboBenefitVsFixedRuleBaseline, writeP3BenchReport } from "./benchmark/p3-benchmarks.js";

const report = await runP3Bench003CboBenefitVsFixedRuleBaseline({
  rows: 18000,
  scoreModulo: 4000,
  scoreWindowStart: 900,
  scoreWindowWidth: 2,
  warmupRounds: 2,
  measuredRounds: 12,
});

assert.equal(report.benchmark, "p3-bench-003-cbo-benefit-vs-fixed-rule-baseline");

assert.equal(report.fixedRuleBaseline.explain.physicalAccessPath, "TABLE_SCAN");
assert.equal(report.fixedRuleBaseline.explain.physicalIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(report.fixedRuleBaseline.explain.physicalStabilityReason, "BAD_PLAN_FALLBACK_PIN");

assert.notEqual(report.cbo.explain.physicalAccessPath, "TABLE_SCAN");
assert.equal(report.cbo.explain.physicalIndexStrategy, "INDEX_SCAN");
assert.equal(report.cbo.explain.physicalStabilityReason, "NONE");

assert.equal(report.fixedRuleBaseline.execution.resultRows, report.cbo.execution.resultRows);
assert.ok(report.cbo.execution.resultRows > 0);

assert.ok(report.fixedRuleBaseline.execution.rowsVisitedPerQuery > report.cbo.execution.rowsVisitedPerQuery);
assert.ok(report.gains.rowsVisitedPerQueryDelta > 0);
assert.ok(report.gains.rowsVisitedReductionPct > 80);

assert.ok(report.gains.physicalCostDelta > 0);
assert.ok(report.gains.physicalCostReductionPct > 50);

assert.equal(report.fixedRuleBaseline.observability.lookupCountTotal, 0);
assert.ok(report.cbo.observability.lookupCountTotal > 0);

assert.equal(report.verdict.cboPreferred, true);
assert.ok(report.verdict.reasons.length >= 3);

const outPath = "reports/p3-bench-003-cbo-benefit-vs-fixed-rule-baseline.json";
await writeP3BenchReport(outPath, report);

console.log(`ok: integration P3-BENCH-003 cbo benefit vs fixed-rule baseline -> ${outPath}`);
