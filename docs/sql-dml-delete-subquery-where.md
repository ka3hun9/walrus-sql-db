# DELETE with Subquery Predicates

## D-DML-005
- DELETE WHERE supports subquery predicate forms:
  - scalar comparison (`= (SELECT ...)`)
  - `IN (SELECT ...)`
  - `EXISTS (SELECT ...)`
- Correlated subquery predicates (`outer.<col>`) are supported in DELETE filtering.
