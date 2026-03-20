# P3-TEST-007 - Million-Row Index-Acceleration Pressure Benchmark

## Scope

Added dedicated Phase 3 pressure coverage for index-acceleration behavior on a million-row dataset.

The benchmark validates a single-table selective predicate path before and after BTREE index creation on the same dataset:
- baseline: no secondary index
- indexed: BTREE index on filter column

## What Was Validated

- Pressure data scale reaches 1,000,000 rows (`p3_test7_users`).
- Query correctness is stable across baseline and indexed paths (same row-count result).
- Baseline query executes full table-scan work (`lastRowsVisited = 1,000,000`).
- Indexed query reduces scan work to matched-row cardinality (`lastRowsVisited = expectedMatchedRows`).
- Index observability confirms lookup-hit activity after index creation.
- Benchmark report is persisted for audit/replay.

## Validation

- Integration: `test/integration-p3-test-007-million-row-index-acceleration-pressure.ts`
- Report output: `reports/p3-test-007-million-row-index-acceleration-bench.json`
