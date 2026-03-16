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
