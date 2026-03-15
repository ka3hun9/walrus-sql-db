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
