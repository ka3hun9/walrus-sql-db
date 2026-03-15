# LIMIT / OFFSET Parsing

## B-PARSE-015
- Parser accepts row-limiting clauses:
  - `LIMIT <n>`
  - `OFFSET <m>`
  - combined form `LIMIT <n> OFFSET <m>`
- Clause-order validation is enforced; invalid sequences (for example `LIMIT` before `ORDER BY`) raise syntax-order errors.
