# HAVING Parsing

## B-PARSE-012
- Parser accepts HAVING clauses in grouped SELECT statements.
- HAVING predicates can reference:
  - aggregate outputs (for example `sum > 20`)
  - grouped non-aggregate keys (for example `region = 'APAC'`)
- HAVING expression is preserved in AST/planning for post-group filtering.
