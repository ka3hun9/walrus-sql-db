# Execution Transaction Context

## P2-EXE-001
- Execution pipeline reads data through transaction-aware table access:
  - reads latest committed state
  - overlays current transaction staged writes for touched tables
- Effect:
  - same session sees its own uncommitted writes (`read_committed + own writes`)
  - other sessions only see committed state
- Verified on join-query execution path, not just single-table reads.
- Coverage: `test/unit-p2-exe-001-transaction-context-pipeline.ts`.
