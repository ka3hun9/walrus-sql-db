# P2 Test-005 Pending/Confirmed Read Policy Suite

## P2-TEST-005
- Covered delayed-confirmation read behavior:
  - pending read view selects latest submitted version
  - confirmed read view selects latest confirmed version
  - manual confirmation promotes visibility as expected
- Targeted test:
  - `test/unit-g-stor-015-pending-confirmed-read-strategy.ts`
