# P2 Test-002 Concurrency RC Suite

## P2-TEST-002
- Covered integration dimensions:
  - dirty-read prohibition across sessions (`READ COMMITTED`)
  - write-conflict behavior under concurrent writers
  - rollback visibility semantics
- Targeted tests:
  - `test/unit-c-exec-016-dirty-read-prohibition-regression.ts`
  - `test/unit-c-exec-018-write-conflict-error-standardization.ts`
  - `test/unit-c-exec-011-transaction-rollback-consistency.ts`
