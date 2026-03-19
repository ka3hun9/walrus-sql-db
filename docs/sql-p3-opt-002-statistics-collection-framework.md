# P3-OPT-002 - Optimizer Statistics Collection Framework

## Scope

Implemented Phase 3 statistics collection groundwork for optimizer inputs:
- table row count
- per-column NDV (`COUNT DISTINCT` over non-null values)
- per-column NULL ratio
- per-column histogram buckets

## What was added

- New optimizer statistics model in `src/client.ts`:
  - table-level stats: `table`, `rowCount`, `analyzedAt`
  - column-level stats: `column`, `rowCount`, `ndv`, `nullCount`, `nullRatio`, `histogram`
  - histogram bucket shape: `lowerBound`, `upperBound`, `rowCount`, `ndv`
- New public API:
  - `getOptimizerStatistics(table?)`
  - collects stats on demand from current in-memory table data
  - deterministic ordering and bounded histogram bucket count
- Planner integration:
  - physical access-path cost estimation now consumes table `rowCount` from optimizer stats.
- `EXPLAIN` integration:
  - exposes collected stats summary (`statsTableRowCount`, `statsColumnCount`, and predicate-column stats fields).

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-002-statistics-collection-framework.ts`
- Regression:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-002-validation.log`
