# Version Chain Durability (P2)

## P2-DUR-001: Immutable Commit Object
- On successful transaction commit, each changed table emits a new immutable versioned storage object.
- Version object shape: `VersionedStorageObject`:
  - `table`, `objectId`, `version`, `commitDigest`, `createdAt`, `immutable`, `rows`
- Objects are append-only per table and retrievable via:
  - `getTableVersionObjects(table?)`
- New commits create new version objects; previous versions remain unchanged.
- Covered by `test/unit-g-stor-011-immutable-version-object-on-commit.ts`.

## P2-DUR-002: Version Chain Metadata
- Version object metadata now includes:
  - `prevVersion`
  - `currentVersion`
  - `commitDigest`
- Chain semantics:
  - first version: `prevVersion = null`, `currentVersion = 1`
  - next version points to prior `currentVersion`
- Covered by `test/unit-g-stor-012-version-chain-metadata.ts`.

## P2-DUR-003: Crash Recovery (WAL + Version Chain)
- Recovery API: `recoverConsistentStateFromWalAndVersionChain({ pendingStrategy })`.
- Recovery flow:
  - restore table data from latest committed version object
  - rebuild unique indexes and row-version tracker
  - resolve pending WAL entries by `rollback` (default) or `replay`
- Returns recovery summary:
  - restored tables
  - pending WAL txn ids before/after recovery
- Covered by `test/unit-g-stor-013-crash-recovery-wal-version-chain.ts`.

## P2-DUR-004: Read Path by Latest Committed Version
- Added `queryLatestCommitted(sql)` read path.
- It executes query against a snapshot sourced from each table's latest committed version object.
- This path ignores caller's uncommitted staged writes and returns deterministic latest-commit results.
- Covered by `test/unit-g-stor-014-query-latest-committed-version.ts`.

## P2-DUR-005: Pending/Confirmed Consistent Read
- Version objects include `confirmationStatus: pending | confirmed`.
- Confirmation APIs/read strategies:
  - `confirmVersionObject(table, version?)`
  - `queryByConfirmation(sql, visibility)` where visibility is `pending` or `confirmed`
- Read semantics:
  - `pending`: latest submitted version (may be unconfirmed)
  - `confirmed`: latest confirmed version only
- Covered by `test/unit-g-stor-015-pending-confirmed-read-strategy.ts`.
