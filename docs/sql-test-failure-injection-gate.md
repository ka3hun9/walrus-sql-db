# Failure Injection Gate

## H-TEST-008
- Added `test/unit-h-test-008-failure-injection-gate.ts`.
- Gate coverage:
  - reuses `G-STOR-005` WAL/retry/backoff injection suite,
  - network transient failure with retry + recovery,
  - storage transient failure with retry + recovery,
  - timeout failure on query path with retry exhaustion,
  - non-retryable storage failure fast-fail (no extra retry), with WAL write-log safety.
