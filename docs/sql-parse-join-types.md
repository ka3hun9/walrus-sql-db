# JOIN Type Parsing

## B-PARSE-003
- Parser supports JOIN type tokens:
  - `INNER JOIN`
  - `LEFT [OUTER] JOIN`
  - `RIGHT [OUTER] JOIN`
  - `FULL OUTER JOIN`
- Bare `JOIN` is parsed as `INNER`.
- Execution support includes `INNER/LEFT/RIGHT/FULL OUTER`.
