# P3-TEST-006 - View-Expansion and Dependency-Change Regression Integration

## Scope

Added dedicated Phase 3 integration coverage for end-to-end view behavior across:
- view expansion and chained-view column mapping correctness
- dependency-change regression on schema mutations (`ALTER TABLE ... DROP COLUMN`, `DROP TABLE`)

## What Was Validated

- Chained view expansion keeps qualified and unqualified column addressing consistent in runtime queries.
- `SELECT *` on chained views returns stable exposed columns after rewrite/materialization.
- Unrelated base-table column drops do not falsely invalidate dependent views.
- Dropping a dependency-bound base column invalidates both direct and chained views with deterministic invalidation reasons.
- Dropping a base table invalidates both direct and chained views and blocks subsequent `SELECT` with deterministic error codes.

## Validation

- Integration: `test/integration-p3-test-006-view-expansion-dependency-change-regression.ts`
