# SQL NULL Semantics

## A-TYPE-015
- Comparison predicates with `NULL` (`=`, `<>`, `<`, `>`, `<=`, `>=`) evaluate to `UNKNOWN`; they do not pass `WHERE`.
- `IS NULL` / `IS NOT NULL` provide explicit NULL filtering.
- Aggregates:
  - `COUNT(*)` counts all rows.
  - `COUNT(expr)` counts non-NULL values only.
  - `SUM/AVG/MIN/MAX` ignore NULL inputs and return `NULL` when no non-NULL values exist.
- Ordering policy: `NULL` values are placed last for both `ASC` and `DESC`.
