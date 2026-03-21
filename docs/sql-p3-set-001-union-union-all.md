# P3-SET-001 - `UNION` / `UNION ALL`

## Scope

Implemented Phase 3 set-operation support for `UNION` and `UNION ALL` with chain execution, deterministic tail planning, and branch projection-shape validation.

## What was added

- Hardened top-level UNION splitting in `src/sql-parser.ts`:
  - split by the **last** top-level `UNION`/`UNION ALL` token
  - preserves left-associative chained set-op semantics during recursive execution
  - keeps `ORDER BY` / `LIMIT` / `OFFSET` tail semantics applied at the full compound-query level
- Extended UNION execution checks in `src/client.ts`:
  - added static projection-arity inference across union trees
  - added runtime projection-width guard to prevent silent row truncation/null-fill on mismatched branches
  - raises `SQL_SEMANTIC_TYPE_MISMATCH` when branch column counts are incompatible
  - preserves left-branch output column naming (including alias behavior)
- Added dedicated Phase 3 test coverage in `test/unit-p3-set-001-union-union-all.ts`:
  - `UNION` vs `UNION ALL` cardinality and dedup behavior
  - chained mixed set-op execution (`UNION ALL` + `UNION`) with global tail order/limit
  - empty-left-branch alias projection behavior
  - explicit and runtime branch arity mismatch error paths

## Validation

- Build:
  - `npm run build`
- Unit:
  - `npx tsx test/unit-p3-set-001-union-union-all.ts`
  - `npx tsx test/unit-c-exec-006-order-limit-stability.ts`
  - `npx tsx test/unit-h-test-002-parser-clause-matrix.ts`
- Validation log:
  - `reports/p3-set-001-validation.log`
