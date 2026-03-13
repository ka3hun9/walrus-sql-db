# G3-B Mismatch Budget Note

Status: Draft (tracking baseline-v1 semantic deltas vs target engines)

## Purpose
Define acceptable mismatch budget while G3-B semantics continue converging, and make deviations explicit instead of implicit.

## Engines
- SQLite (primary differential baseline currently wired)
- PostgreSQL (planned differential track)
- MySQL (planned differential track)

## Budget policy (current)

### PR gate budget
- `g3b-fixture` category:
  - allowed `FAIL`: **0**
  - allowed `XFAIL`: **0**
- `expr` and `subquery` categories (existing matrix):
  - allowed `FAIL`: **0** for PR profile
  - temporary `XFAIL` allowed only with explicit issue link + removal target

### Nightly budget
- Total mismatch ratio target: `<= 2%`
- Any crash-level divergence: `0 tolerance`
- New mismatch without classification: blocked until categorized

## Known budget exceptions (must be explicit)
- None currently in `g3b-fixture` (3/3 pass)
- Existing matrix XFAILs (if any) should be listed in report metadata and linked to owner issue.

## Operational commands
- Run focused G3-B fixture check:
  - `tsx examples/sql-compare-matrix.ts reports/sql-compare-g3b-fixture.json reports/mre pr g3b-fixture`
- Run full matrix (PR):
  - `npm run sql:compare:matrix`
- Run full matrix (nightly):
  - `npm run sql:compare:matrix:nightly`

## G5 fixture budget alignment

- `g5-fixture` is now included in PR category matrix (0 fail budget).
- Nightly now runs dedicated G5 fixture report + budget gate:
  - report: `reports/sql-compare-g5-fixture-nightly.json`
  - gate: `npm run sql:budget:gate -- reports/sql-compare-g5-fixture-nightly.json nightly`
- Policy remains:
  - PR: `maxFailed=0`, `maxMismatchRatio=0`, `maxXpass=0`
  - Nightly: `maxMismatchRatio<=0.02`, `maxXpass=0`

