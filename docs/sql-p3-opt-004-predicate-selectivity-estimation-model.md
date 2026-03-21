# P3-OPT-004 - Predicate Selectivity Estimation Model

## Scope

Implemented Phase 3 predicate selectivity estimation for optimizer planning, including both atomic predicates and composite predicates.

## What was added

- New selectivity model in `src/client.ts`:
  - single-predicate estimation using optimizer stats (`NDV`, `NULL ratio`, histogram buckets)
  - operator coverage for equality/range/`BETWEEN`/`IN`/`LIKE`/`IS NULL` family with deterministic fallbacks
  - composite predicate estimation:
    - `AND`: independence product
    - `OR`: inclusion-exclusion
    - `NOT`: complement
- Planner integration:
  - physical candidate estimated rows now incorporate modeled predicate selectivity.
  - cost model separates scan work (`scannedRows`) from estimated output rows (`estimatedRows`).
- Plan stability safety:
  - bad-plan fallback trigger now uses actual runtime scanned rows, preserving runtime guard behavior while allowing modeled estimated rows.
- `EXPLAIN` observability:
  - added `statsPredicateSelectivity`
  - added `statsPredicateEstimatedRows`

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-004-predicate-selectivity-estimation-model.ts`
- Regression:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-opt-002-statistics-collection-framework.ts`
  - `test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-004-validation.log`
