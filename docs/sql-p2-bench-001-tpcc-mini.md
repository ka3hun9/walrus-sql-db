# P2 Benchmark-001: TPC-C Mini Workload

## P2-BENCH-001

- Added local runnable mini TPC-C style benchmark:
  - `src/p2-benchmarks.ts` → `runP2TpccMiniBenchmark`
  - `examples/p2-bench-tpcc-mini.ts`
  - `npm run p2:bench:tpcc`
- Modelled entities:
  - warehouse / district / customer / order / order_line
- Workload shape:
  - New-order like transaction (`BEGIN` → writes across multiple tables → `COMMIT`)
- Validation/gate:
  - `test/unit-p2-bench-001-tpcc-mini.ts`
