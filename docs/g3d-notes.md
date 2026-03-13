# G3-D Notes (pre-dialect semantic closeout)

## Scope
- Validate composed semantics where set-ops and window functions are chained through derived tables.

## Added regression
- `examples/sql-g3d-setop-window-combo.ts`
  - `UNION ALL` in derived table + outer `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`
  - `UNION` (distinct) in derived table + same outer window spec
  - validates deterministic ranking and set-op cardinality behavior under composition

## Status
- Initial G3-D combo regression is passing in simulator path.
