# G4 - Full Gate & Quality Policy (pre-dialect)

Status: FINAL

## Goals
- Convert G3 semantic consistency into enforceable CI gates.
- Prevent silent regressions in PR and nightly flows.
- Keep mismatch policy explicit and machine-checked.

## Implemented

### 1) Category expansion in CI
- PR category matrix now includes:
  - `g3b-fixture`
  - `g3d-fixture`

### 2) Budget gate script
- Added `examples/sql-budget-gate.ts`
- Added npm script:
  - `npm run sql:budget:gate -- <reportPath> <profile>`

Policy (current hard gate):
- PR:
  - `maxFailed = 0`
  - `maxMismatchRatio = 0`
  - `maxXpass = 0`
- Nightly:
  - `maxMismatchRatio <= 0.02`
  - `maxXpass = 0`
  - (`maxFailed` effectively bounded by ratio)

### 3) Workflow integration
- `.github/workflows/sql-compare.yml`
  - run category compare
  - then run `sql:budget:gate` against `reports/sql-compare-category.json` (`pr`)
- `.github/workflows/sql-compare-nightly.yml`
  - run nightly compare
  - then run `sql:budget:gate` against `reports/sql-compare-nightly.json` (`nightly`)

### 4) Differential fixture coverage update
- Added `g3d-fixture` into compare matrix and CI category list.
- Added SQLite mapping kind `ROW_NUMBER_DERIVED` for derived-table window SQL normalization.

### 5) Semantic bugfix required by gate
- Fixed AST eval `IN/NOT IN` literal list null semantics (`src/sql-ast-eval.ts`) to follow 3VL:
  - `x IN (..., NULL)` with no match => `NULL`
  - `x NOT IN (..., NULL)` with no match => `NULL`

## Validation snapshot
- `npm run build` ✅
- `npm run sql:compare:matrix:category -- g3d-fixture` ✅ (3/3)
- `npm run sql:budget:gate -- reports/sql-compare-category.json pr` ✅
- `npm run sql:compare:matrix:nightly` ✅ (45/45)
- `npm run sql:budget:gate -- reports/sql-compare-nightly.json nightly` ✅

## Exit criteria
- CI enforces budget in both PR and nightly.
- g3b/g3d fixtures are in matrix + workflow categories.
- Nightly mismatch ratio is under threshold and no uncategorized failures remain.
