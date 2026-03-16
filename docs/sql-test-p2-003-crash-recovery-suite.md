# P2 Test-003 Crash Recovery Suite

## P2-TEST-003
- Covered recovery dimensions:
  - crash injection with pending WAL prepare entry
  - consistency restoration from `WAL + version chain`
  - pending-transaction rollback/replay idempotency
- Targeted tests:
  - `test/unit-g-stor-013-crash-recovery-wal-version-chain.ts`
  - `test/unit-g-stor-009-wal-compensation-replay-rollback.ts`
