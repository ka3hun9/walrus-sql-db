# P3-EXE-004 - Spill/Chunk Strategy for Memory-Constrained Execution

## Scope

Implemented a Phase 3 spill/chunk strategy for join execution when runtime row counts exceed in-memory join budget.

## What was added

- Added runtime spill/chunk join path in `src/client.ts`:
  - previous behavior: over-budget non-nested join fell back to `NESTED_LOOP`
  - new behavior: over-budget non-nested join executes chunked spill join using bounded right-side chunks
- Spill/chunk execution keeps join correctness for:
  - `INNER JOIN`
  - `LEFT JOIN`
  - `FULL JOIN`
  - `RIGHT JOIN` (through existing right-to-left rewrite path)
- Added configurable spill chunk size:
  - `joinExecution.spillChunkRows`
  - env: `WALRUS_SQL_JOIN_SPILL_CHUNK_ROWS`
  - effective chunk size is clamped to memory budget
- Extended execution observability:
  - `getSelectExecutionPipelineStats(sql?)` now tracks join spill counters:
    - `joinSpillExecutions`
    - `joinSpillChunks`
    - `joinSpillRowsProcessed`
    - `lastJoinSpillSteps`
    - `lastJoinSpillChunks`
    - `lastJoinSpillRowsProcessed`
  - `EXPLAIN` now reports `physicalJoinSpillChunkRows`

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-exe-004-spill-chunk-memory-constrained.ts`
- Regression:
  - `test/unit-p3-exe-002-join-executor-memory-budget.ts`
  - `test/unit-c-exec-001-full-outer-join.ts`
  - `test/unit-p3-exe-003-large-result-pipeline.ts`
- Validation log (2026-03-20):
  - `reports/p3-exe-004-validation.log`
