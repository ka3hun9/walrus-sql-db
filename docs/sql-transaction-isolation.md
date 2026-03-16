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
