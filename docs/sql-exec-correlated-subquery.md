# Correlated Subquery Execution

## C-EXEC-004
- Correlated subqueries bind outer-row references via `outer.<column>`.
- Binding is evaluated per outer row and supports multiple outer predicates in one subquery.
- Covered correlated forms include:
  - `EXISTS` / `NOT EXISTS`
  - `IN (SELECT ...)`
  - scalar subquery comparisons
