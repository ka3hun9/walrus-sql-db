# P3-TEST-004 - Complex Subquery Integration (Scalar / Correlated / EXISTS / IN)

## Scope

Added dedicated Phase 3 integration coverage for complex subquery behavior across mixed predicate forms in a single end-to-end scenario.

## What Was Validated

- Correlated scalar subquery comparison works with aggregate projection (`MAX`) and preserves row filtering correctness.
- Correlated `EXISTS` predicate filters rows by outer-row bindings.
- Non-correlated `IN (SELECT ...)` predicate returns expected membership results.
- Correlated `IN (SELECT ...)` predicate with `outer` bindings returns expected per-region membership results.
- A combined complex query using `IN + EXISTS + scalar-subquery` preserves correctness under chained predicate evaluation.
- Subquery runtime observability records correlated execution stats for the correlated `EXISTS` and scalar subqueries.

## Validation

- Integration: `test/integration-p3-test-004-complex-subquery-scalar-correlated-exists-in.ts`
