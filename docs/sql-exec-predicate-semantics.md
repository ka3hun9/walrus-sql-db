# Predicate Execution Semantics

## C-EXEC-002
- Execution paths are covered for:
  - `BETWEEN` / `NOT BETWEEN`
  - `LIKE` / `NOT LIKE` with `ESCAPE`
  - `IN` / `NOT IN` with value lists
  - `IN` subquery
  - `EXISTS` / `NOT EXISTS` (correlated and non-correlated forms)
- `EXISTS` / `NOT EXISTS` short-circuit on the first qualifying inner row for non-aggregate subqueries.
- NULL rows in predicate operands follow three-valued logic and are excluded unless explicitly matched by NULL-aware predicates.
