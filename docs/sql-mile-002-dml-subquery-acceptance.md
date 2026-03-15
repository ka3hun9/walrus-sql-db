# Milestone Acceptance: DML Subquery Paths

## J-MILE-002
- Added `test/unit-j-mile-002-dml-subquery-acceptance.ts`.
- Acceptance flow covers:
  - `UPDATE` with combined predicates (`IN` subquery + `LIKE/BETWEEN` logic),
  - `DELETE` with correlated `EXISTS` and scalar subquery condition.
- Pass condition:
  - final persisted rows match expected DML effects after both statements.
