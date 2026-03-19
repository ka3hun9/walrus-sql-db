# P3-IDX-005 - Separated Index Object Persistence (with Version Chain)

## Scope

Implemented index-object persistence that is separated from table-row version objects. Indexes are now stored as independent immutable objects with their own version chain metadata.

## What was added

- Independent index version object model:
  - `IndexVersionedStorageObject` with:
    - `indexName`, `table`, `column`, `indexType`
    - `prevVersion`, `currentVersion`, `commitDigest`, `createdAt`
    - immutable payload using row-key references (not embedded table rows)
- Client runtime persistence APIs:
  - `getIndexVersionObjects(indexName?)`
  - `confirmIndexVersionObject(indexName, version?)`
- Commit lifecycle integration:
  - On table-changing transaction commit, active table indexes emit new immutable index objects.
  - `CREATE INDEX` emits initial index object snapshot.
- Recovery integration:
  - `recoverConsistentStateFromWalAndVersionChain()` restores secondary indexes from latest index version objects.
  - Falls back to rebuild only if index object metadata is unavailable or incompatible.

## Separation guarantees

- Table data version chain remains in `VersionedStorageObject` (`rows` payload).
- Index version chain is stored separately in `IndexVersionedStorageObject`.
- Index payload stores row references (`rowKeys`) rather than full row bodies.

## Validation

- Unit: `test/unit-p3-idx-005-index-object-storage-version-chain.ts`
