# P2 Bench-003 Soak Stability

## P2-BENCH-003
- Added soak runner for long-duration stability verification:
  - API: `runTpccLikeSoakBenchmark(...)`
  - example: `examples/sql-tpcc-like-soak.ts`
  - command: `npm run sql:tpcc:soak`
- Soak report aggregates:
  - run count
  - attempted/committed/aborted totals
  - conflict totals
  - accumulated consistency errors
- Coverage:
  - `test/unit-p2-bench-003-soak-stability.ts`
