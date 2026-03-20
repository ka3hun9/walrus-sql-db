# P3-BENCH-002 - Control: Indexed Same-Load Benefit Report (QPS/P95/Cost)

## Scope

Added a Phase 3 benchmark control that runs the same selective analytic workload twice on the same dataset:
- baseline: no secondary index
- indexed: with secondary indexes on predicate columns

The report records and compares:
- throughput (`QPS`)
- latency (`P95`)
- execution cost (`rowsVisitedPerQuery`)
- planner cost (`physicalCost` from `EXPLAIN`)

## Workload

- Table:
  - `p3_bench2_orders`
- Query shape:
  - selective `WHERE` (`status` equality + `customer_id` range)
  - `GROUP BY`
  - aggregate projection (`SUM(amount)`)
  - `ORDER BY` + `LIMIT`
- Index policy:
  - baseline phase: no `CREATE INDEX`
  - indexed phase:
    - `CREATE INDEX idx_p3_bench2_orders_status ON p3_bench2_orders(status)`
    - `CREATE INDEX idx_p3_bench2_orders_customer_id ON p3_bench2_orders(customer_id)`

## Validation

- Source implementation: `src/p3-benchmarks.ts` (`runP3Bench002IndexedSameLoadBenefit`)
- Runnable example: `examples/p3-bench-002-indexed-same-load-benefit.ts`
- Integration validation: `test/integration-p3-bench-002-indexed-same-load-benefit.ts`
- Report output: `reports/p3-bench-002-indexed-same-workload-benefit.json`
