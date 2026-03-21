# P3-TEST-001 - Index Structure Correctness and Update Consistency

## Scope

Added dedicated Phase 3 unit coverage for secondary-index structure integrity and DML consistency across non-transaction and transaction paths.

## What was validated

- HASH + BTREE index catalog state is correct after table/index setup.
- Index stats remain consistent after `INSERT` / `UPDATE` / `DELETE` in direct DML mode.
- Rollback keeps table rows and index stats unchanged.
- Commit applies staged DML and keeps query results aligned with index state.
- Immutable index version objects contain expected payload shape and key ordering:
  - BTREE payload entries are ordered and map to expected row references.
  - HASH payload buckets map to expected row references.

## Validation

- Unit: `test/unit-p3-test-001-index-structure-update-consistency.ts`
