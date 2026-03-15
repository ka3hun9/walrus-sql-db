# Milestone Acceptance: Complex Query

## J-MILE-001
- Added `test/unit-j-mile-001-complex-query-acceptance.ts`.
- Acceptance query includes:
  - multi-table join (`INNER` + `LEFT`)
  - grouped aggregate (`SUM`)
  - `HAVING` filter
  - `ORDER BY` + `LIMIT/OFFSET` pagination
- Pass condition:
  - deterministic paged result matches expected grouped order.
