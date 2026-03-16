# FK ON DELETE RESTRICT / NO ACTION

## P2-FK-005
- Parent-row delete now checks referencing FK rows for actions:
  - `ON DELETE RESTRICT`
  - `ON DELETE NO ACTION`
- If any referencing child row exists, delete is rejected with:
  - `ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY`
- This validation runs in the same delete traversal used by cascade behavior.
- Coverage: `test/unit-f-fk-005-on-delete-restrict-no-action.ts`.
