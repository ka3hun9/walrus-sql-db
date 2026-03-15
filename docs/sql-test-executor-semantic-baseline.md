# Executor Semantic Baseline Coverage

## H-TEST-003
- Added `test/unit-h-test-003-executor-semantic-baseline.ts` as the executor semantic gate.
- Gate scope:
  - Executes all `C-EXEC-001..007` semantic unit suites.
  - Runs SQLite differential comparison for executor-focused categories:
    - `compare`, `null-3vl`, `like`, `in-between`, `subquery`, `correlated`, `expr`, `logic`, `having`.
- Acceptance condition: generated diff report has `failed = 0`.
