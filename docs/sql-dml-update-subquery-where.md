# UPDATE with Subquery Predicates

## D-DML-002
- UPDATE WHERE supports subquery predicate forms:
  - scalar comparison (`= (SELECT ...)`)
  - `IN (SELECT ...)`
  - `EXISTS (SELECT ...)`
- Correlated subquery predicates (`outer.<col>`) are supported in UPDATE WHERE evaluation.
