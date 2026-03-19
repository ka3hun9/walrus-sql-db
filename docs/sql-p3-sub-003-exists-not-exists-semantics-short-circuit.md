# P3-SUB-003 - EXISTS / NOT EXISTS Semantics and Short-Circuit

## Scope

Implemented Phase 3 `EXISTS` / `NOT EXISTS` execution improvements to preserve predicate semantics while reducing subquery scan work.

## What was added

- Added an `EXISTS`-specific subquery evaluation path in `src/client.ts`:
  - exits on the first qualifying inner row for non-aggregate subqueries
  - records results in statement-scope subquery cache with an `EXISTS` cache-key suffix
  - reuses correlated-subquery stats (`executions`, `cache hits/misses`, `rowsScanned`, `rowsReturned`)
- Preserved aggregate subquery behavior under `EXISTS`:
  - aggregate projections (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) continue through the existing full subquery-select path
  - avoids changing result cardinality semantics for aggregate forms
- Routed `WHERE EXISTS` / `WHERE NOT EXISTS` clause evaluation to the new runtime path.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-sub-003-exists-not-exists-short-circuit.ts`
  - `test/unit-p3-sub-002-correlated-subquery-binding-cost-control.ts`
  - `test/unit-c-exec-002-predicate-semantics.ts`
  - `test/unit-d-dml-005-delete-subquery-where.ts`
- Validation log (2026-03-20):
  - `reports/p3-sub-003-validation.log`
