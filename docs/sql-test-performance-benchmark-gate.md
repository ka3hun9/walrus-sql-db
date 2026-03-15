# Performance Benchmark Gate

## H-TEST-006
- Extended benchmark dimensions to explicitly cover:
  - `write_throughput`
  - `cold_query_throughput`
  - `hot_query_throughput`
- Updated benchmark config schema in `src/performance-benchmarks.ts`:
  - `writeRows`, `coldQueries`, `hotQueries`
- Added gate test:
  - `test/unit-h-test-006-performance-benchmark-gate.ts`
  - validates benchmark samples and report serialization.
