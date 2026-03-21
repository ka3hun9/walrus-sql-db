# P2 Benchmark-002: Conflict Throughput/Latency Baseline

## P2-BENCH-002

- Added conflict-scene benchmark:
  - `src/p2-benchmarks.ts` → `runP2ConflictBenchmark`
  - `examples/p2-bench-conflict.ts`
  - `npm run p2:bench:conflict`
- Scenario:
  - Two concurrent sessions write same PK row
  - Commit-point conflict detection and standardized rejection path
- Metrics:
  - commit operations
  - overall throughput (`opsPerSec`)
  - average commit latency (`avgLatencyMs`)
  - conflict count (`conflicts`)
- Validation/gate:
  - `test/unit-p2-bench-002-conflict-throughput.ts`
