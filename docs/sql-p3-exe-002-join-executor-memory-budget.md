# P3-EXE-002 - Join Executor Algorithm Switching with Memory Budget Control

## Scope

Implemented Phase 3 join-executor memory governance on top of multi-algorithm join execution:
- `NESTED_LOOP`
- `HASH_JOIN`
- `SORT_MERGE_JOIN`

The executor now chooses among algorithms using both estimated cost and configured memory budget limits.

## What was added

- Added configurable join memory budget in client options:
  - `joinExecution.memoryBudgetRows`
  - default: `4096`
  - config env support: `WALRUS_SQL_JOIN_MEMORY_BUDGET_ROWS`
- Extended physical join planning in `src/client.ts`:
  - per-algorithm memory estimation (`NESTED_LOOP`, `HASH_JOIN`, `SORT_MERGE_JOIN`)
  - candidate filtering by memory budget before cost ranking
  - per-step plan metadata:
    - `estimatedMemoryRows`
    - `memoryBudgetRows`
    - `memoryBudgetConstrained`
- Added runtime memory guard in join execution dispatch:
  - if a chosen non-nested algorithm exceeds budget on actual row counts, execution falls back to `NESTED_LOOP`.
- Extended `EXPLAIN` observability:
  - `physicalJoinMemoryBudgetRows`
  - `physicalJoinPlan` now includes memory estimate and budget-constrained marker.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-exe-002-join-executor-memory-budget.ts`
  - `test/unit-p3-opt-007-join-algorithms.ts`
- Regression:
  - `test/unit-c-exec-001-full-outer-join.ts`
- Validation log (2026-03-20):
  - `reports/p3-exe-002-validation.log`
