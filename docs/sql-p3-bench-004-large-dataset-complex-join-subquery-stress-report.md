# P3-BENCH-004 - Large-Dataset Complex Join/Subquery Stress Report

## Scope

Added a Phase 3 stress benchmark for large datasets that combines:
- multi-table complex join execution
- complex subquery execution (`IN` + correlated `EXISTS` + correlated scalar subquery)

The report records and compares:
- throughput (`QPS`)
- latency (`P95`)
- execution scan cost (`rowsVisitedPerQuery`)
- physical plan evidence (`physicalJoinCount`, `physicalJoinAlgorithms`, `physicalJoinPlan`)
- subquery execution evidence (`executions`, `correlatedExecutions`, cache/scan stats)

## Workload

- Tables:
  - `p3_bench4_customers`
  - `p3_bench4_orders`
  - `p3_bench4_shipments`
  - `p3_bench4_refunds`
- Join workload:
  - `INNER JOIN` + `LEFT JOIN`
  - status/tier/delivery filters
  - `GROUP BY` + aggregate projection
  - `ORDER BY` + `LIMIT`
- Subquery workload:
  - outer query over customers
  - `IN (subquery)` over paid orders
  - correlated `EXISTS` subquery over shipped orders
  - correlated scalar subquery (`AVG(order_amount)`)

## Validation

- Source implementation: `src/p3-benchmarks.ts` (`runP3Bench004LargeDatasetComplexJoinSubqueryStress`)
- Runnable example: `examples/p3-bench-004-large-dataset-complex-join-subquery-stress.ts`
- Integration validation: `test/integration-p3-bench-004-large-dataset-complex-join-subquery-stress.ts`
- Report output: `reports/p3-bench-004-large-dataset-complex-join-subquery-stress.json`
- Validation log: `reports/p3-bench-004-validation.log`
