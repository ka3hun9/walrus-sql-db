# P3-OPT-006 - Cost-Based Join Reorder

## Scope

Implemented Phase 3 join-order search for multi-join SELECT planning with cost-based reorder in logical planning.

## What was added

- Cost-based join reorder in `src/client.ts` logical planner:
  - applies to multi-join `INNER JOIN` chains.
  - keeps base table fixed, then greedily picks the next join edge with minimal estimated step cost.
  - uses optimizer statistics (`rowCount`, `NDV`, `nullRatio`) for join selectivity estimation.
  - uses table-local predicate selectivity from `WHERE` clauses to estimate filtered table cardinality before join ordering.
- Reorder safety guards:
  - disabled when join chain contains non-inner joins (`LEFT` / `RIGHT` / `FULL`).
  - disabled when join predicates are not table-qualified or contain duplicate/self table names.
  - falls back to canonical join order when join graph cannot be expanded from base table.
- Logical plan observability:
  - added `joinReorder` metadata (`applied`, `algorithm`, `estimatedCost`, original/final join order).
  - new rewrite rule marker: `RULE_COST_BASED_JOIN_REORDER`.
- `EXPLAIN` output extension:
  - `logicalJoinReorderApplied`
  - `logicalJoinReorderAlgorithm`
  - `logicalJoinReorderCost`
  - `logicalJoinOrderOriginal`
  - `logicalJoinOrderFinal`
- Join execution field resolution improvement:
  - join key lookup now supports qualified fields first, with unqualified fallback.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-006-join-reorder-cost-based.ts`
- Regression:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-opt-005-index-selection-strategy.ts`
  - `test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-006-validation.log`
