# IN Subquery Parsing

## B-PARSE-008
- Parser accepts subquery predicates:
  - `expr IN (SELECT ...)`
  - `expr NOT IN (SELECT ...)`
- Subquery predicates are preserved for downstream WHERE evaluation and execution planning.
