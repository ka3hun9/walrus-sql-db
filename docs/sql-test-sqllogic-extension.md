# Sqllogic Extension Set

## H-TEST-005
- Added phase-two sqllogic fixture:
  - `test/sqllogic/p2-extended.slt`
- Fixture coverage includes:
  - `JOIN`, correlated subquery, `GROUP BY/HAVING`, `ORDER BY + LIMIT/OFFSET`
  - `UPDATE ... JOIN`, `DELETE ... IN (subquery)`
  - negative statement case (`PRIMARY KEY` duplicate)
- Added gate test:
  - `test/unit-h-test-005-sqllogic-extension.ts`
  - executes both `p1-basic.slt` and `p2-extended.slt` through `examples/sql-logic-runner.ts`.
