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
- `examples/sql-g3d-setop-error-regression.ts`
  - validates malformed set-op SQL fails deterministically with syntax code
  - scenarios: dangling `UNION`, right branch missing SELECT
- `examples/sql-g3d-in-literal-ast-regression.ts`
  - validates `IN` / `NOT IN` literal-list semantics on AST predicate path
  - guards against premature NULL short-circuit in binary eval

## Differential fixture mapping
- Added `g3d-fixture` category in `examples/sql-compare-matrix.ts`
  - set-op distinct + outer order/limit/offset
  - set-op all + outer order/limit/offset
  - set-op + window composition through derived table
- Current PR profile check: `g3d-fixture` 3/3 PASS

## Status
- Initial G3-D combo regression is passing in simulator path.
