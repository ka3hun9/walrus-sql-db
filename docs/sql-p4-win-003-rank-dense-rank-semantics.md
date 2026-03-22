# Window Rank Dense-Rank Semantics

## P4-WIN-003
- Added execution support for `RANK()` and `DENSE_RANK()` window functions.
- Window planning/execution now uses a shared window-function pipeline for:
  - `ROW_NUMBER()`
  - `RANK()`
  - `DENSE_RANK()`
- Tie semantics are now explicit and deterministic within each partition:
  - `RANK()` assigns equal rank for ties and keeps rank gaps.
  - `DENSE_RANK()` assigns equal rank for ties and does not leave rank gaps.
- Partition and order expressions are resolved with typed key grouping and stable intra-tie ordering.

## Verification
- `test/unit-p4-win-003-rank-dense-rank-semantics.ts`
  - validates AST binding for `RANK()` / `DENSE_RANK()` window metadata
  - validates tie/gap behavior for `RANK()`
  - validates tie/no-gap behavior for `DENSE_RANK()`
  - validates partition-only rank baseline and `ROW_NUMBER()` regression path

### Command Output
- `npm run build`
  - pass
- `npx tsx test/unit-p4-win-003-rank-dense-rank-semantics.ts`
  - `ok: P4-WIN-003 rank/dense-rank tie and gap semantics`
- `npx tsx test/unit-p4-win-001-window-over-parser-binding.ts`
  - `ok: P4-WIN-001 OVER(PARTITION BY ... ORDER BY ...) parser binding`
