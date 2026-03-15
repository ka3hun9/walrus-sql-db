# UPDATE with Complex WHERE

## D-DML-001
- UPDATE execution supports complex WHERE predicates, including:
  - `BETWEEN` / `NOT BETWEEN`
  - `LIKE` / `NOT LIKE` with `ESCAPE`
  - `IN` / `NOT IN` (value list)
  - `EXISTS` / `NOT EXISTS` (including correlated forms)
- Predicate evaluation uses the same 3VL semantics as SELECT filtering.
