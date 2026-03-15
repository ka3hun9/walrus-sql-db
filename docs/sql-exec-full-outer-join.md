# FULL OUTER JOIN Execution

## C-EXEC-001
- FULL OUTER JOIN execution now includes:
  - matched pairs (`left` + `right`)
  - unmatched left-side rows padded with right-side `NULL`s
  - unmatched right-side rows padded with left-side `NULL`s
- Behavior is aligned across simulator query execution and replay execution paths.
