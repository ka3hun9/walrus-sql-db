# P3-IDX-007 - Index Replay and Recovery Consistency

## Scope

Validated index consistency after durability recovery paths that combine version-chain restoration with WAL pending-transaction resolution.

## What is covered

- Recovery entrypoint:
  - `recoverConsistentStateFromWalAndVersionChain({ pendingStrategy })`
- Two pending strategies:
  - `replay`: replays pending WAL transaction and applies local table/index writes.
  - `rollback`: rolls back pending WAL transaction and keeps latest committed version-chain state.
- Index consistency checks after recovery:
  - BTREE query path correctness (`ORDER BY` / predicate reads).
  - BTREE index stats align with recovered row set size.
  - Table data and index runtime stay consistent after simulated in-memory corruption.

## Validation

- Unit: `test/unit-p3-idx-007-index-replay-recovery-consistency.ts`
- Validation log (2026-03-19): `reports/p3-idx-007-validation.log`
