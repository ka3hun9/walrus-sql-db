# P3-SUB-001 - Scalar Subquery Execution and Single-Row Error Semantics

## Scope

Implemented Phase 3 scalar-subquery execution rules for comparison predicates with strict scalar cardinality constraints.

## What was added

- Scalar comparison predicates now accept full left-side expressions for subquery comparison forms:
  - example: `id * 30 = (SELECT amount FROM ...)`
- Scalar subquery cardinality semantics are enforced:
  - `0` rows => scalar value resolves to `NULL`
  - `>1` rows => `ERR_UNSUPPORTED_SUBQUERY` (`Scalar subquery must return exactly 1 row`)
  - `>1` columns => `ERR_UNSUPPORTED_SUBQUERY` (`Scalar subquery must return exactly 1 column`)
- Coverage includes both `SELECT` and `UPDATE` execution paths using scalar subqueries.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-sub-001-scalar-subquery-single-row-semantics.ts`
  - `test/unit-c-exec-003-scalar-subquery-cardinality.ts`
  - `test/unit-d-dml-002-update-subquery-where.ts`
- Validation log (2026-03-19):
  - `reports/p3-sub-001-validation.log`
