# Transaction Consistency Operations Manual (P2)

## Scope
- This manual covers Phase-2 transaction-consistency operations for:
  - transaction state control (`BEGIN` / `COMMIT` / `ROLLBACK`)
  - isolation (`READ COMMITTED`)
  - WAL and compensation (`PREPARE` / `COMMIT` / `ROLLBACK`)
  - durability recovery (`WAL + version chain`)
  - pending/confirmed visibility and version confirmation

## Runtime Baseline
- Use `WalrusSqlClient` with explicit transaction settings:

```ts
const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  transactionTimeoutMs: 5000,
  wal: {
    enabled: true,
    filePath: ".cache/walrus-sql/transaction.wal.ndjson",
    archivePath: ".cache/walrus-sql/transaction.wal.archive.ndjson",
    checkpointPath: ".cache/walrus-sql/transaction.wal.checkpoint.json",
    maxEntries: 2000,
  },
  transactionCommitExecutor: async (payload) => ({ digest: `digest-${payload.txnId}` }),
});
```

## Normal Operations
1. Start transaction with `BEGIN`.
2. Execute DML (`INSERT` / `UPDATE` / `DELETE`) inside active transaction.
3. Verify local read-your-writes via `query(...)`.
4. End with `COMMIT` (success path) or `ROLLBACK` (abort path).
5. Track runtime health with `getTransactionObservabilityStats()`.

## Visibility Operations
- Query latest submitted state: `queryLatestCommitted(sql)` or `queryByConfirmation(sql, "pending")`.
- Query only confirmed state: `queryByConfirmation(sql, "confirmed")`.
- Confirm chain version object after external confirmation:
  - `confirmVersionObject(table)`
  - `confirmVersionObject(table, version)`

## WAL And Recovery Operations
- Inspect unresolved prepared transactions:
  - `recoverPendingTransactionLogsFromWal()`
- Resolve pending transactions with one strategy:
  - replay: `replayPendingTransactionLogsFromWal()`
  - rollback: `rollbackPendingTransactionLogsFromWal()`
- Persist checkpoint and enforce retention:
  - `checkpointWal()`
- Recover a consistent in-memory state from durable artifacts:
  - `recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: "rollback" | "replay" })`

## Error Handling Guide
- `ERR_TRANSACTION_STATE`
  - invalid transaction transition, timeout, aborted-session statement, or commit-window conflicts.
- `ERR_UNSUPPORTED_DDL`
  - DDL inside active transaction is rejected (`policy=forbid_ddl_in_tx`).
- `ERR_CONSTRAINT_VIOLATION:WRITE_CONFLICT`
  - optimistic write conflict detected during `COMMIT`.
- `ERR_EXECUTION_FAILED`
  - non-retryable onchain/storage execution failures or exhausted retry attempts.

## Runbook Checks
1. Confirm `isolationLevel` is `read_committed`.
2. Confirm WAL path is writable and checkpoint path is configured.
3. Confirm commit executor is healthy if pending/confirmed lifecycle is enabled.
4. Confirm pending WAL queue length from `recoverPendingTransactionLogsFromWal()`.
5. Confirm checkpoint freshness from `checkpointWal()`.

## Runnable Example
- Example file: `examples/sql-p2-transaction-consistency.ts`
- Command:

```bash
npm run sql:p2:txn:consistency
```
