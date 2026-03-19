# P3-VIEW-006 - Updatable-View Deferred Boundary and Error Codes

## Scope

Phase 3 view capability remains read-only:

- allowed: `CREATE VIEW`, `DROP VIEW`, `SELECT` on views
- deferred: all DML write paths that target a view, and join-aware DML that references a view source

## Runtime Boundary

In `WalrusSqlClient` simulator mode, view writes are rejected deterministically:

- `INSERT INTO <view> ...`
  - `ERR_UNSUPPORTED_INSERT`
- `UPDATE <view> ...`
  - `ERR_UNSUPPORTED_UPDATE`
- `DELETE FROM <view> ...`
  - `ERR_UNSUPPORTED_DELETE`
- `UPDATE ... JOIN <view> ...`
  - `ERR_UNSUPPORTED_UPDATE`
- `DELETE ... FROM ... JOIN <view> ...`
  - `ERR_UNSUPPORTED_DELETE`

Error detail contract:

- `updatable view is deferred in Phase 3: <OP> <target|source> cannot reference view <VIEW_NAME>`

This prevents fallback to `ERR_TABLE_NOT_FOUND` for known views and keeps the boundary machine-parseable by operation family.

## Regression Coverage

- Added `test/unit-p3-view-006-updatable-view-deferred-boundary-error-codes.ts`
  - verifies deterministic error codes for `INSERT`/`UPDATE`/`DELETE` against view targets
  - verifies deterministic error codes for join-aware `UPDATE`/`DELETE` when a joined source is a view
  - verifies no mutation is applied to base tables when rejected writes are attempted
