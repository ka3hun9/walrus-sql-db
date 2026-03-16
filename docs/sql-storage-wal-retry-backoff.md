# WAL / Retry / Backoff Failure Injection

## G-STOR-005
- Onchain retry behavior verified under injected failures:
  - transient retryable failures retry up to `maxAttempts` and can recover
  - persistent retryable failures exhaust retries and return `ERR_EXECUTION_FAILED`
  - non-retryable failures fail fast (no retry loop)
  - query path (`onchainQueryExecutor`) follows the same retry policy
- WAL safety check:
  - storage write log is recorded only after successful onchain execution
  - failed writes do not append WAL/storage-write entries
- Covered by `test/unit-g-stor-005-wal-retry-backoff-failure-injection.ts`.

## P2-LOG-001
- Transaction log payload is defined in `src/types.ts`:
  - `TransactionLogRecordPayload`: `{ txnId, writeSet, at }`
  - `TransactionLogWriteEntry`: `{ table, op, key, preImage, postImage }`
  - `TransactionLogRecord`: payload + `checksum`
- `createTransactionLogRecord()` normalizes payload and validates image semantics:
  - `INSERT`: `preImage=null`, `postImage!=null`
  - `UPDATE`: both images required
  - `DELETE`: `preImage!=null`, `postImage=null`
- `computeTransactionLogChecksum()` uses deterministic JSON key ordering with SHA-256.
- `verifyTransactionLogRecordChecksum()` verifies integrity and tamper detection.
- Covered by `test/unit-g-stor-006-transaction-log-structure.ts`.

## P2-LOG-002
- WAL persistence is available through `WalrusSqlClientOptions.wal`:
  - `enabled`: turn WAL persistence on/off
  - `filePath`: NDJSON WAL file path (default `.cache/walrus-sql/transaction.wal.ndjson`)
- Commit path (`mode=simulator`) now writes:
  - `PREPARE` record before apply (`record` includes txn writeSet + checksum)
  - `COMMIT` marker after apply
  - `ROLLBACK` marker when commit flow fails after prepare
- Recovery entry API: `recoverPendingTransactionLogsFromWal()`:
  - reads WAL NDJSON
  - validates prepared record checksum
  - returns unresolved prepared transactions (`PREPARE` without `COMMIT`/`ROLLBACK`)
- skips malformed lines safely
- Covered by `test/unit-g-stor-007-wal-persistence-recovery-entry.ts`.

## P2-LOG-003
- Commit batch processor hook: `WalrusSqlClientOptions.transactionCommitExecutor(payload)`.
- `payload` is `TransactionCommitBatchPayload`:
  - single `txnId`
  - transaction-level `writeSet` aggregation
  - checksum + timestamp copied from WAL prepare record
- COMMIT flow (`mode=simulator`) invokes the hook once per transaction commit after `PREPARE` and before local apply.
- This provides one-shot transaction aggregation for chain-side submission adapters.
- Covered by `test/unit-g-stor-008-transaction-commit-batch-processor.ts`.

## P2-LOG-004
- Commit interruption now keeps `PREPARE` pending instead of auto-marking rollback.
- Compensation APIs:
  - `replayPendingTransactionLogsFromWal()`:
    - replays pending prepared transactions through commit batch processor
    - appends `COMMIT` markers for successful replays
    - returns replayed vs failed txn ids
  - `rollbackPendingTransactionLogsFromWal()`:
    - appends `ROLLBACK` markers for pending prepared transactions
    - returns rolled-back txn ids
- Both APIs are idempotent across repeated calls (second call sees no pending entries).
- Covered by `test/unit-g-stor-009-wal-compensation-replay-rollback.ts`.
