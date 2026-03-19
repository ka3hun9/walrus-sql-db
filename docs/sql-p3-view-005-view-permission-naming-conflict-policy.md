# P3-VIEW-005 - View Permission and Naming-Conflict Baseline Policy

## Scope

Implemented a minimal, controllable policy layer for view operations in Phase 3, covering:

- Basic view permissions for `CREATE VIEW`, `DROP VIEW`, and `SELECT` on views.
- Deterministic naming-conflict guards between table names and view names.

## What was added

- Added `viewPolicy` to `WalrusSqlClientOptions` in `src/types.ts`:
  - `allowCreate?: boolean`
  - `allowDrop?: boolean`
  - `allowSelect?: boolean`
  - `allowedViewNames?: string[]`
- Added runtime permission checks in `src/client.ts`:
  - `CREATE VIEW` denied when `allowCreate === false`.
  - `DROP VIEW` denied when `allowDrop === false`.
  - `SELECT` from views denied when `allowSelect === false`.
  - Optional whitelist gating through `allowedViewNames`.
- Added naming-conflict policy in `src/client.ts`:
  - Reject `CREATE VIEW <name>` when an existing table already uses `<name>`.
  - Reject `CREATE TABLE <name>` when an existing view already uses `<name>`.

## Regression Coverage

- Added `test/unit-p3-view-005-view-permission-naming-conflict-policy.ts`:
  - table/view name conflict on `CREATE VIEW`
  - view/table name conflict on `CREATE TABLE`
  - permission denials for create/select/drop
  - allowed-view whitelist behavior
