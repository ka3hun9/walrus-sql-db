# LIKE / ESCAPE Parsing

## B-PARSE-006
- Parser accepts:
  - `expr LIKE pattern`
  - `expr NOT LIKE pattern`
  - optional `ESCAPE` clause (`... LIKE pattern ESCAPE 'x'`)
- LIKE predicates with ESCAPE are supported in WHERE parsing and evaluated with the provided single-character escape symbol.
