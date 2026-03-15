# JOIN Type Parsing

## B-PARSE-003
- Parser supports JOIN type tokens:
  - `INNER JOIN`
  - `LEFT [OUTER] JOIN`
  - `RIGHT [OUTER] JOIN`
  - `FULL OUTER JOIN`
- Bare `JOIN` is parsed as `INNER`.
- Current execution support remains:
  - implemented: `INNER/LEFT/RIGHT`
  - not yet implemented: `FULL OUTER` (explicit `ERR_UNSUPPORTED_SELECT` at execution stage)
