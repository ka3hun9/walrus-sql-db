# FK ON DELETE CASCADE

## P2-FK-004
- `DELETE` now applies FK `ON DELETE CASCADE` actions.
- Cascade behavior is recursive across dependency chains (parent -> child -> grandchild).
- Cascaded row removals follow the same delete bookkeeping path:
  - unique-index maintenance
  - transaction log entries
  - row-version updates (non-transactional immediate path)
- `DELETE` statement `affectedRows` includes direct + cascaded deletions.
- Coverage: `test/unit-f-fk-004-on-delete-cascade.ts`.
