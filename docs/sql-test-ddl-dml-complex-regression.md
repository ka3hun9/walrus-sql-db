# DDL/DML Complex Regression Set

## H-TEST-004
- Added `test/unit-h-test-004-ddl-dml-complex-regression.ts` as a combined regression gate.
- Gate coverage:
  - Runs all `D-DML-001..007` suites.
  - Runs all `E-DDL-001..004` suites.
  - Adds one integrated flow with:
    - `ALTER TABLE ADD COLUMN` + `ALTER TABLE DROP COLUMN`,
    - `UPDATE` with subquery and `INNER JOIN`,
    - `DELETE` with scalar subquery and `LEFT JOIN`.
