# Aggregate Function Parsing

## B-PARSE-013
- Parser recognizes aggregate functions in SELECT list:
  - `COUNT(...)`
  - `SUM(...)`
  - `AVG(...)`
  - `MIN(...)`
  - `MAX(...)`
- Aggregate function nodes are preserved in AST for grouped/aggregate planning.
