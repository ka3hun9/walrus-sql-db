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
