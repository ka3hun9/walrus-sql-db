# NULL Three-Valued Logic Execution

## C-EXEC-007
- Filtering follows 3VL:
  - `v = NULL` => `UNKNOWN` (row filtered out)
  - `NOT (v = 1)` keeps only rows where predicate resolves to `TRUE`
- Join predicates treat `NULL` join keys as non-matching (no `NULL = NULL` join matches).
- Aggregates ignore NULL values and compute over non-NULL inputs.
