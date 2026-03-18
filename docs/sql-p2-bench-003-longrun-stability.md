# P2 Benchmark-003: Long-Run Stability

## P2-BENCH-003

- Added long-run stability benchmark:
  - `src/p2-benchmarks.ts` → `runP2LongRunStability`
  - `examples/p2-bench-longrun.ts`
  - `npm run p2:bench:longrun`
- Workload:
  - Continuous transactional insert loop for configurable duration
  - Periodic consistency checks (`COUNT(*) == committed writes`)
- Output notes:
  - `consistency_checks=<n>`
  - `errors=<n>`
- Validation/gate:
  - `test/unit-p2-bench-003-longrun-stability.ts`
