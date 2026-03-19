# P3-OPT-003 - Statistics Persistence and Version Management

## Scope

Implemented Phase 3 optimizer statistics persistence with immutable version history, replay reads, and version-to-version diff compare.

## What was added

- New optimizer statistics version-chain object model in `src/client.ts`:
  - immutable per-table stats snapshots (`objectId`, `prevVersion`, `currentVersion`, `commitDigest`, `confirmationStatus`)
  - persisted stats payload (`table`, `rowCount`, `analyzedAt`, per-column NDV/NULL/histogram)
- New public APIs:
  - `getOptimizerStatsVersionObjects(table?)`
  - `confirmOptimizerStatsVersionObject(table, version?)`
  - `replayOptimizerStatistics(table, { visibility?, version? })`
  - `compareOptimizerStatisticsVersions(table, fromVersion, toVersion)`
  - `getOptimizerStatistics(table?, { source: "versioned" | "live", visibility?, version? })`
- Persistence hooks:
  - records optimizer stats version objects on committed transaction DML.
  - records optimizer stats version objects on non-transaction DML/`ALTER TABLE` with confirmed status.
  - participates in transaction commit rollback snapshots so failed commit apply restores pre-change stats history.
- Replay/compare behavior:
  - replay supports latest-by-visibility (`pending` / `confirmed`) and exact version lookup.
  - compare returns table-level delta plus per-column change deltas for rowCount/NDV/NULL/histogram metrics.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-003-statistics-persistence-version-management.ts`
- Regression:
  - `test/unit-p3-opt-002-statistics-collection-framework.ts`
  - `test/unit-p3-idx-005-index-object-storage-version-chain.ts`
- Validation log (2026-03-20):
  - `reports/p3-opt-003-validation.log`
