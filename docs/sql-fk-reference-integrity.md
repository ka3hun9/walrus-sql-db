# FK Reference Integrity

## P2-FK-003
- `INSERT/UPDATE` validates child FK key values against parent rows.
- Visibility for parent lookup is transaction-aware:
  - reads latest committed rows
  - includes current transaction staged writes for referenced parent tables
- Null handling:
  - `MATCH SIMPLE|PARTIAL`: any null FK component skips parent existence check
  - `MATCH FULL`: partial-null child key is rejected
- Violations are reported as `ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY`.
- Coverage: `test/unit-f-fk-003-insert-update-integrity.ts`.
