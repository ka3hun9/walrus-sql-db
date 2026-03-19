# P3-IDX-006 - DML Incremental Index Maintenance

## Scope

Implemented incremental secondary-index maintenance on `INSERT`/`UPDATE`/`DELETE`, including transaction commit apply path.

## What was added

- Incremental index maintenance for direct DML:
  - `INSERT`: row is added into active HASH/BTREE indexes without full-table rebuild.
  - `UPDATE`: old index entry removed, new index entry inserted.
  - `DELETE`: row removed from active HASH/BTREE indexes.
- Transaction commit integration:
  - Commit no longer rebuilds secondary indexes per touched table.
  - Applies index deltas from staged write-log entries (`INSERT`/`UPDATE`/`DELETE`) against committed runtime.
  - Recomputes index stats after delta apply.
- Existing DDL/recovery rebuild behavior remains available for bootstrap/fallback.

## Current constraints

- Incremental path targets active single-column HASH/BTREE entries (same scope as current index runtime).
- Query-time logic remains compatible with existing planner/executor behavior.

## Validation

- Unit: `test/unit-p3-idx-006-dml-incremental-index-maintenance.ts`
