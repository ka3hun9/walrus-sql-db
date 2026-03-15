# BETWEEN Predicate Parsing

## B-PARSE-005
- Parser supports:
  - `expr BETWEEN lower AND upper`
  - `expr NOT BETWEEN lower AND upper`
- BETWEEN predicates participate in normal WHERE precedence rules and are available in AST as dedicated binary operators.
