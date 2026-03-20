# P3-BENCH-001 - Baseline: No-Index Complex Query Throughput/Latency Report

## Scope

Added a dedicated Phase 3 benchmark baseline for complex-query performance without secondary indexes.

The benchmark runs a multi-join + aggregation + ORDER/LIMIT query over a synthetic workload and records:
- throughput (`QPS`)
- latency distribution (`min/p50/p95/p99/max`)
- execution scan cost (`rowsVisited`)
- no-index evidence from explain/observability stats

## Workload

- Tables:
  - `p3_bench1_customers`
  - `p3_bench1_orders`
  - `p3_bench1_refunds`
- Query shape:
  - `INNER JOIN` + `LEFT JOIN`
  - status/tier filtering
  - `GROUP BY` + aggregate projection
  - `ORDER BY` + `LIMIT`
- Index policy:
  - no `CREATE INDEX` step
  - expected access path remains `TABLE_SCAN`

## Validation

- Source implementation: `src/p3-benchmarks.ts` (`runP3Bench001NoIndexComplexBaseline`)
- Runnable example: `examples/p3-bench-001-no-index-complex-baseline.ts`
- Integration validation: `test/integration-p3-bench-001-no-index-complex-query-baseline.ts`
- Report output: `reports/p3-bench-001-no-index-complex-baseline.json`
