# P3-SET-002 - `INTERSECT` / `INTERSECT ALL`

## Scope

Implemented Phase 3 set-operation support for `INTERSECT` and `INTERSECT ALL` with chained execution, shared tail-planning, and projection-shape validation parity with existing set-op behavior.

## What was added

- Extended top-level set-op parsing in `src/sql-parser.ts`:
  - recognizes `INTERSECT` and `INTERSECT ALL`
  - keeps recursive split-by-last-token behavior for chained set operations
  - reuses set-op tail semantics (`ORDER BY` / `LIMIT` / `OFFSET`) at compound-query level
- Extended set-op execution in `src/client.ts`:
  - `INTERSECT` returns distinct overlap rows
  - `INTERSECT ALL` returns multiset overlap (`min(left_count, right_count)`)
  - preserves left-branch output column names/aliases
  - raises `SQL_SEMANTIC_TYPE_MISMATCH` for branch projection-arity mismatches
- Added dedicated Phase 3 coverage in `test/unit-p3-set-002-intersect-intersect-all.ts`:
  - distinct vs `ALL` cardinality behavior
  - chained mixed execution with tail ordering/limit
  - alias projection on left-branch output columns
  - explicit and runtime arity mismatch error paths

## Validation

- Build:
  - `npm run build`
- Unit:
  - `npx tsx test/unit-p3-set-002-intersect-intersect-all.ts`
  - `npx tsx test/unit-p3-set-001-union-union-all.ts`
  - `npx tsx test/unit-h-test-002-parser-clause-matrix.ts`
- Validation log:
  - `reports/p3-set-002-validation.log`
