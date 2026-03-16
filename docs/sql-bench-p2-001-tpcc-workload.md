# P2 Bench-001 TPC-C Like Workload

## P2-BENCH-001
- Added reproducible local benchmark workload:
  - module: `src/p2-benchmarks.ts`
  - example runner: `examples/sql-tpcc-like-benchmark.ts`
  - npm script: `npm run sql:tpcc:bench`
- Workload includes warehouse/customer/order tables and transactional order flow.
- Smoke coverage:
  - `test/unit-p2-bench-001-tpcc-workload-smoke.ts`
