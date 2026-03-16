# P2 Test-004 FK Regression Suite

## P2-TEST-004
- Covered FK regression dimensions:
  - `ON DELETE CASCADE` recursive behavior
  - `ON DELETE RESTRICT/NO ACTION` blocking behavior
  - FK cycle detection and cascade-depth protection
- Targeted tests:
  - `test/unit-f-fk-004-on-delete-cascade.ts`
  - `test/unit-f-fk-005-on-delete-restrict-no-action.ts`
  - `test/unit-f-fk-007-cycle-depth-protection.ts`
