# Transaction Isolation (P2)

## P2-ISO-001: READ COMMITTED
- `WalrusSqlClientOptions.isolationLevel` is now explicit (`read_committed`).
- `WalrusSqlClient` constructs a READ COMMITTED read view for table access:
  - current session reads staged rows for tables modified in its active transaction (read-your-writes)
  - otherwise reads committed table state
- Dirty reads are blocked across sessions sharing the same committed store:
  - writer session sees uncommitted staged rows
  - reader session sees only committed rows until writer commits
- Covered by `test/unit-c-exec-013-read-committed-view.ts`.

## P2-ISO-002: OCC Write Conflict Detector
- Chosen path for `P2-ISO-002`: optimistic concurrency control (version-conflict detector).
- Engine now tracks committed row versions per table key.
- Transaction write-set captures observed committed versions for written rows.
- On `COMMIT`, engine checks observed vs current versions:
  - mismatch => `ERR_CONSTRAINT_VIOLATION:WRITE_CONFLICT`
  - match => commit proceeds and row versions advance
- Covered by `test/unit-c-exec-014-occ-write-conflict-detector.ts`.

## P2-ISO-003: Timeout Mechanism
- With OCC mode, lock wait/deadlock graph is replaced by transaction timeout guard.
- Config: `WalrusSqlClientOptions.transactionTimeoutMs`.
- Behavior:
  - active transaction exceeding timeout is transitioned to `aborted`
  - subsequent statement fails with `ERR_TRANSACTION_STATE` timeout error
  - caller must `ROLLBACK` to return to `idle`
- Covered by `test/unit-c-exec-015-transaction-timeout-guard.ts`.

## P2-ISO-004: Dirty Read Prohibition Validation
- Added explicit cross-session regression for dirty-read prevention:
  - reader cannot observe writer's uncommitted insert/update
  - rollback keeps reader-visible state unchanged
  - commit makes changes visible afterwards
- Covered by `test/unit-c-exec-016-dirty-read-prohibition-regression.ts`.
