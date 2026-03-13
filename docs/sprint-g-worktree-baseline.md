# Sprint G Worktree Baseline

Date: 2026-03-13
Scope: Pre-G0 cleanup snapshot for serial execution

## Branch State
- Branch: `main`
- Tracking: `origin/main`
- Ahead: `25` commits

## Current Dirty Changes

### Modified (tracked)
- `reports/sql-compare-category.json`
- `scripts/install-sui-cli.ps1`
- `src/index.ts`

### Untracked
- `docs/SPRINT_G_HYBRID_PLAN.md`
- `examples/debug-ast-where.ts`
- `reports/tmp-check.json`
- `reports/mre/**` (generated repro SQL artifacts)
- `scripts/tools/**` (downloaded Sui binaries/archive)

## Classification (for Sprint G hygiene)

### Keep as source/project docs
- `docs/SPRINT_G_HYBRID_PLAN.md`

### Keep conditionally (if needed for code path)
- `src/index.ts` (exports `sql-ast-eval`)
- `scripts/install-sui-cli.ps1` (if installer flow changed intentionally)

### Generated/runtime artifacts (do not treat as core source)
- `reports/sql-compare-category.json`
- `reports/tmp-check.json`
- `reports/mre/**`

### Local toolchain binaries (do not commit)
- `scripts/tools/**`

## Immediate G0 Actions
1. Confirm which modified tracked files are intentional (`src/index.ts`, `scripts/install-sui-cli.ps1`).
2. Keep generated reports as local artifacts unless explicitly versioned for CI examples.
3. Ensure local binaries under `scripts/tools/**` are ignored.
4. Start G0 contract freeze deliverables after hygiene confirmation.
