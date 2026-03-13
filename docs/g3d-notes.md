# G3-D Notes (pre-dialect semantic closeout)

## Scope
- Validate composed semantics where set-ops and window functions are chained through derived tables.

## Added regression
- `examples/sql-g3d-setop-window-combo.ts`
  - `UNION ALL` in derived table + outer `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`
  - `UNION` (distinct) in derived table + same outer window spec
  - validates deterministic ranking and set-op cardinality behavior under composition
- `examples/sql-g3d-setop-projection-order-regression.ts`
  - validates set-op projection schema behavior follows left branch output names/order
  - validates `UNION` distinct vs `UNION ALL` cardinality under aligned projection
  - validates ordering stability after set-op on left-branch column names
- `examples/sql-g3d-setop-order-limit-offset-regression.ts`
  - validates outer ORDER BY/LIMIT/OFFSET is applied on merged set-op result
  - covers both `UNION` distinct and `UNION ALL` pagination behavior

## Status
- Initial G3-D combo regression is passing in simulator path.
