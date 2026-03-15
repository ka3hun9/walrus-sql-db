# Scalar Subquery Comparison Parsing

## B-PARSE-010
- Parser accepts scalar-subquery comparison predicates for operators:
  - `=`, `<>`, `>`, `>=`, `<`, `<=`
- Example form: `expr <op> (SELECT ...)`
- Parsed predicates are preserved for subquery-aware WHERE evaluation.
