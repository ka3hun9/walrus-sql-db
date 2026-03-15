# IN List Parsing

## B-PARSE-007
- Parser supports value-list predicates:
  - `expr IN (v1, v2, ...)`
  - `expr NOT IN (v1, v2, ...)`
- IN-list predicates are represented as dedicated binary operators in AST and accepted in WHERE clauses.
