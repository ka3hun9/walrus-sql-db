# P3-TEST-008 - Long-Run Stability (Consistency + Performance Degradation Threshold)

## Scope

Added dedicated Phase 3 long-run integration coverage for sustained workload stability, including:
- continuous transactional writes
- indexed lookup path continuity under sustained mutations
- periodic consistency checks across base-table and view paths
- bounded correlated-subquery probe validation (separate small probe table)
- explicit performance-degradation threshold gating

## What Was Validated

- Long-run workload continuously commits writes for the configured run window.
- No consistency errors are tolerated during sustained execution (`errors = 0`).
- Base-table cardinality remains exact during periodic checkpoints (`COUNT(*) == expected writes`).
- View-expansion count path remains consistent with tracked expected values.
- Correlated-subquery path is validated with positive `correlatedExecutions` stats on probe workload.
- Indexed target-customer query remains stable under ongoing writes and keeps visited-row scope bounded by result cardinality.
- Tail latency is explicitly threshold-gated:
  - minimum sustained throughput floor
  - degradation-ratio cap (`tailAvg / baselineAvg`)
- Benchmark report is persisted for replay/audit.

## Validation

- Integration: `test/integration-p3-test-008-longrun-stability-consistency-performance-threshold.ts`
- Report output: `reports/p3-test-008-longrun-stability-report.json`
