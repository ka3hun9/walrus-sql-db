# Incremental Write Replay Stability

## G-STOR-002
- Added reusable incremental replay helper:
  - `replayPayloadsIncremental(initialRows, payloads, initialCommitHash?)`
- Guarantees:
  - deterministic replay result for full vs segmented incremental application
  - commit-chain verification (`previousCommitHash/currentCommitHash`) with invalid payload accounting
  - immutable insert application (insert rows are cloned)
- Covered by `test/unit-g-stor-002-incremental-replay-stability.ts`.
