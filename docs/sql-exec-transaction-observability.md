# Transaction Observability

## P2-EXE-004
- Added `getTransactionObservabilityStats()` on `WalrusSqlClient`.
- Reported metrics include:
  - transaction counts: `started`, `committed`, `aborted`
  - `abortRatio`
  - latency: `avgTxnLatencyMs`, `maxTxnLatencyMs`, `totalTxnLatencyMs`
  - commit wait visibility: `totalLockWaitMs`, `lockWaitEvents`
- Metrics are updated on successful commit, rollback-abort, timeout-abort, and runtime error-abort paths.
- Coverage: `test/unit-p2-exe-004-transaction-observability.ts`.
