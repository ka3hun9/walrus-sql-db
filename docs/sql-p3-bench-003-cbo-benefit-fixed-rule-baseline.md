# P3-BENCH-003 - CBO Benefit: Plan Selection Better Than Fixed-Rule Baseline

## Scope

Added a Phase 3 benchmark that compares the same indexed dataset and same SQL under two plan-selection policies:
- fixed-rule baseline: forced `TABLE_SCAN`
- CBO: optimizer chooses the lowest-cost access path

The report records and compares:
- throughput (`QPS`)
- latency (`P95`)
- execution scan cost (`rowsVisitedPerQuery`)
- planner cost (`physicalCost` from `EXPLAIN`)
- plan decision evidence (`physicalAccessPath`, `physicalStabilityReason`)

## Workload

- Table:
  - `p3_bench3_metrics`
- Query shape:
  - selective single-column range filter on `score`
  - covering projection (`SELECT score`)
  - `ORDER BY score ASC LIMIT`
- Index policy:
  - both scenarios use the same index:
    - `CREATE INDEX idx_p3_bench3_score ON p3_bench3_metrics(score)`
  - baseline policy pins runtime plan to `TABLE_SCAN` (`ALWAYS_TABLE_SCAN`)
  - CBO policy keeps default optimizer choice

## Validation

- Source implementation: `src/p3-benchmarks.ts` (`runP3Bench003CboBenefitVsFixedRuleBaseline`)
- Runnable example: `examples/p3-bench-003-cbo-benefit-vs-fixed-rule-baseline.ts`
- Integration validation: `test/integration-p3-bench-003-cbo-benefit-vs-fixed-rule-baseline.ts`
- Report output: `reports/p3-bench-003-cbo-benefit-vs-fixed-rule-baseline.json`
