# P2 Bench-002 Conflict Baseline

## P2-BENCH-002
- Conflict-aware throughput/latency baseline report is supported via:
  - benchmark runner: `examples/sql-tpcc-like-benchmark.ts`
  - preset command: `npm run sql:tpcc:bench:conflict`
- Report includes:
  - `throughputTps`
  - `latencyMs` (`avg/p95/max`)
  - `conflictsDetected`
  - `abortedTransactions` and `abortRatio`
- Coverage:
  - `test/unit-p2-bench-002-conflict-baseline-report.ts`
