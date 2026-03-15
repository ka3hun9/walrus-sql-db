# UPDATE JOIN Variants

## D-DML-003
- UPDATE JOIN predicate path supports:
  - `INNER JOIN`
  - `LEFT JOIN`
  - `RIGHT JOIN`
  - `FULL OUTER JOIN`
- Left-table update semantics:
  - `INNER/RIGHT`: update only rows with join matches
  - `LEFT/FULL`: allow unmatched left rows to participate (right side treated as NULL)
