# P3-EXE-005 - Onchain/Replay Read Path Index-Consistent Visibility Strategy

## Scope

Implemented visibility-aware index read strategy for snapshot-based read paths (`queryByConfirmation` / `queryLatestCommitted`) so index planning aligns with pending/confirmed version visibility.

## What was added

- Added snapshot index-catalog builder in `src/client.ts`:
  - filters snapshot-visible indexes by `pending|confirmed` visibility using index version-object confirmation status.
  - excludes indexes that have version history but no version visible for the requested confirmation scope.
- Extended snapshot query bootstrap:
  - snapshot client now receives the visibility-filtered index catalog.
  - snapshot secondary indexes are prebuilt before query execution, so `EXPLAIN` and normal reads use the same consistent index state.
- Preserved read correctness:
  - when index visibility differs from table visibility, queries still return the same rows; only physical access path selection changes as expected.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-exe-005-onchain-replay-index-consistent-read-strategy.ts`
- Regression:
  - `test/unit-p3-exe-001-index-scan-executor.ts`
  - `test/unit-g-stor-015-pending-confirmed-read-strategy.ts`
  - `test/unit-g-stor-014-query-latest-committed-version.ts`
- Validation log (2026-03-20):
  - `reports/p3-exe-005-validation.log`
