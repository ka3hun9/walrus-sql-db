# P2 Test-006 SQLLogic Transaction/FK Suite

## P2-TEST-006
- Extended `test/sqllogic/p2-extended.slt` with transaction/FK fixtures:
  - FK violation error case
  - transaction rollback visibility
  - transaction commit visibility
  - FK cascade effect in fixture flow
- Gate execution:
  - `test/unit-h-test-005-sqllogic-extension.ts`
