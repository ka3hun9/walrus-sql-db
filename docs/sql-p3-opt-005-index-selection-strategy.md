# P3-OPT-005 - Index Selection Strategy

## Scope

Implemented Phase 3 index selection strategy in optimizer physical planning:
- full table scan (`TABLE_SCAN`)
- index scan (`INDEX_SCAN`)
- index back-to-table (`INDEX_BACK_TABLE`)

## What was added

- Access strategy classification in `src/client.ts`:
  - `FULL_TABLE_SCAN`
  - `INDEX_SCAN`
  - `INDEX_BACK_TABLE`
- Covering-index detection for single-table SELECT:
  - validates whether projected/filter/order columns are fully covered by the chosen index column.
  - classifies index path as `INDEX_SCAN` when covered, otherwise `INDEX_BACK_TABLE`.
- Cost model enhancement:
  - back-to-table paths now include extra row-fetch penalty.
  - enables optimizer to prefer `TABLE_SCAN` for low-selectivity non-covering index plans.
- Index candidate selection improvement:
  - hash/btree candidate discovery now evaluates all usable indexes and picks the most selective candidate.
- `EXPLAIN` observability:
  - added `physicalOptimizerIndexStrategy`
  - added `physicalIndexStrategy`
  - `physicalCandidates` now includes per-candidate `access=` strategy marker.
- Plan-stability safety integration:
  - bad-plan fallback trigger now applies only to index paths classified as `INDEX_BACK_TABLE`.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-005-index-selection-strategy.ts`
- Regression:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-opt-004-predicate-selectivity-estimation-model.ts`
  - `test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-005-validation.log`
