# DELETE with Complex WHERE

## D-DML-004
- DELETE WHERE supports complex predicates, including:
  - `BETWEEN`
  - `LIKE ... ESCAPE`
  - `IN (...)`
  - `EXISTS (SELECT ...)` (including correlated forms)
- Predicate semantics and 3VL behavior are shared with SELECT/UPDATE filtering.
