# Milestone Acceptance Report: Subquery and Set Operations

## P3-MILE-003

## Scope
- Milestone target: full-path acceptance for Phase 3 subquery and set-operation capabilities.
- Required acceptance dimensions:
  - subquery execution path coverage for scalar/correlated/`EXISTS`/`IN`/`NOT IN` (including NULL three-valued logic behavior);
  - set-operation matrix coverage for `UNION` / `UNION ALL` / `INTERSECT ALL` / `EXCEPT ALL`;
  - chained execution path mixing subquery predicates and set operations with tail `ORDER BY` + pagination.

## Acceptance Gate
- Runtime gate test:
  - `test/unit-p3-mile-003-subquery-setop-acceptance.ts`
- This gate validates:
  - correlated scalar subquery filtering and correlated `EXISTS` filtering;
  - `IN` / `NOT IN` behavior with NULL-bearing subquery outputs and non-NULL filtered variant;
  - multiset semantics for `UNION ALL` / `INTERSECT ALL` / `EXCEPT ALL` and distinct semantics for `UNION`;
  - full-path chained query (`IN` + `EXISTS` + `UNION ALL` + `EXCEPT ALL` + `ORDER BY/LIMIT/OFFSET`);
  - subquery runtime stats exposure via `getSubqueryExecutionStats`.

## Validation Commands
- `npm run build`
- `npx tsx test/unit-p3-sub-001-scalar-subquery-single-row-semantics.ts`
- `npx tsx test/unit-p3-sub-002-correlated-subquery-binding-cost-control.ts`
- `npx tsx test/unit-p3-sub-003-exists-not-exists-short-circuit.ts`
- `npx tsx test/unit-p3-sub-004-in-not-in-subquery-null-3vl.ts`
- `npx tsx test/unit-p3-set-001-union-union-all.ts`
- `npx tsx test/unit-p3-set-002-intersect-intersect-all.ts`
- `npx tsx test/unit-p3-set-003-except-except-all.ts`
- `npx tsx test/unit-p3-set-004-setop-order-page-projection-compat.ts`
- `npx tsx test/integration-p3-test-004-complex-subquery-scalar-correlated-exists-in.ts`
- `npx tsx test/integration-p3-test-005-set-operation-full-matrix-all-variants.ts`
- `npx tsx test/unit-p3-mile-003-subquery-setop-acceptance.ts`

## Result
- All validation commands pass.
- Milestone verdict: `PASS`.

## Recorded Output (2026-03-20)
- `npm run build`
  - `walrus-sql-db@0.3.0 build`
  - `npm run clean && tsc -p tsconfig.json`
- `npx tsx test/unit-p3-sub-001-scalar-subquery-single-row-semantics.ts`
  - `ok: P3-SUB-001 scalar subquery execution and single-row error semantics`
- `npx tsx test/unit-p3-sub-002-correlated-subquery-binding-cost-control.ts`
  - `ok: P3-SUB-002 correlated subquery outer binding and cost control`
- `npx tsx test/unit-p3-sub-003-exists-not-exists-short-circuit.ts`
  - `ok: P3-SUB-003 EXISTS/NOT EXISTS semantics and short-circuit optimization`
- `npx tsx test/unit-p3-sub-004-in-not-in-subquery-null-3vl.ts`
  - `ok: P3-SUB-004 IN/NOT IN subquery semantics with NULL 3VL`
- `npx tsx test/unit-p3-set-001-union-union-all.ts`
  - `ok: P3-SET-001 UNION / UNION ALL semantics`
- `npx tsx test/unit-p3-set-002-intersect-intersect-all.ts`
  - `ok: P3-SET-002 INTERSECT / INTERSECT ALL semantics`
- `npx tsx test/unit-p3-set-003-except-except-all.ts`
  - `ok: P3-SET-003 EXCEPT / EXCEPT ALL semantics`
- `npx tsx test/unit-p3-set-004-setop-order-page-projection-compat.ts`
  - `ok: P3-SET-004 set-op order/page/projection compatibility`
- `npx tsx test/integration-p3-test-004-complex-subquery-scalar-correlated-exists-in.ts`
  - `ok: integration P3-TEST-004 complex subquery coverage (scalar/correlated/EXISTS/IN)`
- `npx tsx test/integration-p3-test-005-set-operation-full-matrix-all-variants.ts`
  - `ok: integration P3-TEST-005 set-op full matrix (incl. ALL variants)`
- `npx tsx test/unit-p3-mile-003-subquery-setop-acceptance.ts`
  - `ok: P3-MILE-003 subquery + set-operation full-path acceptance`
