# P3-TEST-003 - CBO Plan Selection and Plan-Stability Regression

## Scope

Added dedicated Phase 3 integration coverage for end-to-end optimizer behavior across:
- CBO physical-path selection
- CBO join-order selection
- plan-stability bad-plan fallback regression

## What Was Validated

- CBO chooses `BTREE_INDEX_LOOKUP + INDEX_SCAN` for selective covering-range predicates.
- CBO chooses `TABLE_SCAN + FULL_TABLE_SCAN` for broad low-selectivity non-covering predicates.
- CBO join reorder is applied for eligible `INNER JOIN` chains (`GREEDY_CBO`) and preserves result correctness.
- Executing a broad non-covering index path triggers bad-plan fallback tracking.
- Subsequent executions in fallback window pin runtime access path to `TABLE_SCAN` while preserving result-set correctness.
- Plan-stability state counters (`badPlanFallbackCount`, cooldown remaining, executions) evolve as expected.

## Validation

- Integration: `test/integration-p3-test-003-cbo-plan-selection-stability-regression.ts`
