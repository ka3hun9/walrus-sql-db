# EXISTS Predicate Parsing

## B-PARSE-009
- Parser accepts:
  - `EXISTS (SELECT ...)`
  - `NOT EXISTS (SELECT ...)`
- Both correlated (`outer.<col>`) and non-correlated subquery forms are preserved for downstream predicate evaluation.
