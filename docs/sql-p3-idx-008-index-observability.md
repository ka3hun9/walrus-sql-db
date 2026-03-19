# P3-IDX-008 - Index Observability Metrics

## Scope

Added index observability metrics for lookup hit/miss, maintenance cost, and failure-rate style signals.

## What was added

- Runtime metrics store per table (`indexObservability`):
  - lookup metrics:
    - `lookupCount`
    - `lookupHits`
    - `lookupMisses`
    - derived `hitRate`, `failureRate`
  - maintenance metrics:
    - `maintenanceInsertOps`
    - `maintenanceUpdateOps`
    - `maintenanceDeleteOps`
    - `maintenanceRebuildOps`
    - `maintenanceRows`
- New API:
  - `getIndexObservability(table?)`
- Instrumented paths:
  - Hash index lookup path (`=` predicates)
  - BTREE range lookup path
  - BTREE ordered scan path
  - DML incremental index maintenance (`INSERT`/`UPDATE`/`DELETE`)
  - Rebuild maintenance path (`INDEX_REBUILD`)

## Validation

- Unit: `test/unit-p3-idx-008-index-observability-metrics.ts`
- Regression: `test/unit-p3-idx-007-index-replay-recovery-consistency.ts`
- Validation log (2026-03-19): `reports/p3-idx-008-validation.log`
