# P3-VIEW-002 - View Expansion Rewrite and Column-Mapping Consistency

## Scope

Implemented deterministic column mapping during view expansion (`query rewrite` runtime path) so qualified projection columns from view definitions remain queryable and stable across chained views.

## What was fixed

- Materialized view rows are now normalized to stable exposed column names:
  - prefers the leaf column name for qualified identifiers (for example `orders.id` -> `id`)
  - preserves uniqueness with deterministic fallback when collisions occur
- `SELECT` projection binding now resolves qualified identifiers through semantic identifier resolution when an exact row key is absent.
- This closes the mapping gap where `SELECT view_name.col FROM view_name` could yield `null` even when `col` exists.

## Behavior notes

- Chained views without explicit aliases now keep usable output columns (`id`, `dept`, `score`) instead of drifting into upstream-qualified raw names.
- Qualified outer references remain valid (`view002_chain.id`) and map consistently to the exposed view columns.

## Regression coverage

- `test/unit-p3-view-002-view-expansion-column-mapping-consistency.ts`
  - direct view projection with qualified identifiers
  - chained view expansion without explicit aliases
  - mixed qualified/unqualified projection correctness
