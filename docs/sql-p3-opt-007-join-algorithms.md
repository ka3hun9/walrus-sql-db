# P3-OPT-007 - Join Algorithm Implementation

## Scope

Implemented Phase 3 multi-algorithm join execution for SELECT join paths:
- `NESTED_LOOP`
- `HASH_JOIN`
- `SORT_MERGE_JOIN`

## What was added

- Physical join planning in `src/client.ts`:
  - per-join-step algorithm selection based on estimated row counts and cost.
  - estimated join output row propagation across multi-join chains.
- Join algorithm cost model:
  - nested loop: `O(left * right)` style estimate.
  - hash join: build/probe estimate with spill penalty when build side is large.
  - sort-merge join: sort work + merge pass estimate.
- Runtime execution paths:
  - dedicated nested loop executor.
  - dedicated hash join executor (typed-key hash buckets).
  - dedicated sort-merge join executor (typed-key sort/merge matching).
- OUTER join semantics preserved across all algorithms:
  - `LEFT`, `RIGHT` (via rewrite to synthetic `LEFT`), and `FULL`.
  - unmatched row padding behavior remains consistent with existing join output shape.
- `EXPLAIN` observability extension:
  - `physicalJoinCount`
  - `physicalJoinAlgorithms`
  - `physicalJoinPlan`

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-007-join-algorithms.ts`
- Regression:
  - `test/unit-c-exec-001-full-outer-join.ts`
  - `test/unit-c-exec-007-null-3vl-consistency.ts`
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-opt-006-join-reorder-cost-based.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-007-validation.log`
