# P3-SUB-002 - Correlated Subquery Outer Binding and Cost Control

## Scope

Implemented Phase 3 correlated-subquery execution improvements for deterministic `outer` binding and bounded runtime cost behavior.

## What was added

- Correlated `outer.<col>` binding now runs in evaluation context instead of SQL string replacement:
  - avoids accidental replacement inside quoted literals (for example `'outer.id'`)
  - keeps correlated predicate resolution in the normal identifier resolver path
- Subquery execution plan caching per statement:
  - parsed subquery shape and `WHERE` predicate tree are reused
- Correlated-subquery result memoization per statement:
  - cache key = normalized subquery SQL + bound outer-reference values
  - repeated outer bindings reuse prior subquery results
- Correlated-subquery cost guard:
  - scan work is tracked in statement scope
  - excessive correlated scan cost throws `ERR_UNSUPPORTED_SUBQUERY`
- New observability API:
  - `getSubqueryExecutionStats(subquerySql?)`
  - exposes executions, cache hits/misses, scan counts, and budget-exceeded count

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-sub-002-correlated-subquery-binding-cost-control.ts`
  - `test/unit-c-exec-004-correlated-subquery.ts`
  - `test/unit-d-dml-002-update-subquery-where.ts`
  - `test/unit-p3-sub-001-scalar-subquery-single-row-semantics.ts`
- Validation log (2026-03-19):
  - `reports/p3-sub-002-validation.log`
