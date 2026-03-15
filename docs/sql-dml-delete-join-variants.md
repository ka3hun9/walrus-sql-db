# DELETE JOIN Variants

## D-DML-006
- DELETE JOIN predicate path supports:
  - `INNER JOIN`
  - `LEFT JOIN`
  - `RIGHT JOIN`
  - `FULL OUTER JOIN`
- Left-table delete semantics:
  - `INNER/RIGHT`: delete only rows with join matches.
  - `LEFT/FULL`: unmatched left rows can participate (right side treated as `NULL`).
