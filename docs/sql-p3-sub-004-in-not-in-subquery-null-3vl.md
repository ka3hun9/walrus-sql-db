# P3-SUB-004 - `IN` / `NOT IN` Subquery Semantics with NULL 3VL

## Scope

Implemented Phase 3 `IN` / `NOT IN` subquery semantics with SQL NULL three-valued logic behavior for both correlated and non-correlated predicates.

## What was added

- Hardened subquery projection parsing for predicate evaluation in `src/client.ts`:
  - switched subquery select-list splitting from plain `,` split to top-level comma splitting
  - correctly supports single-expression projections that include internal commas (for example `COALESCE(col, -1)`)
- Added explicit single-column arity enforcement for `IN` / `NOT IN` subqueries:
  - validates projection shape before row evaluation
  - preserves `ERR_UNSUPPORTED_SUBQUERY` error semantics even when subquery result is empty
- Added dedicated Phase 3 test coverage in `test/unit-p3-sub-004-in-not-in-subquery-null-3vl.ts`:
  - non-correlated `IN` / `NOT IN` with NULL participation (`UNKNOWN` propagation)
  - correlated `IN` / `NOT IN` with `outer` bindings
  - empty-subquery behavior (`IN => FALSE`, `NOT IN => TRUE`, including left NULL)
  - expression projection with internal comma (`COALESCE`)
  - single-column arity error path
  - DML update path guarded by `NOT IN` subquery semantics

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-sub-004-in-not-in-subquery-null-3vl.ts`
  - `test/unit-p3-sub-003-exists-not-exists-short-circuit.ts`
  - `test/unit-c-exec-002-predicate-semantics.ts`
  - `test/unit-d-dml-005-delete-subquery-where.ts`
- Validation log (2026-03-20):
  - `reports/p3-sub-004-validation.log`
