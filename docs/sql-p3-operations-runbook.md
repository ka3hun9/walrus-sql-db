# P3 Operations Runbook

## Scope
This runbook defines the Phase 3 daily verification flow for documentation/examples/regression-sync and milestone acceptance.

## Prerequisites
- Node.js + npm installed
- Dependencies installed: `npm install`
- Run from repository root

## Recommended Daily Flow
```bash
npm run build
npm run sql:compare:matrix:category
npm run sql:logic:all
```

## Extended Regression Flow
```bash
npm run sql:semantic:grouped
npm run ci:full
```

## Milestone Mapping
- P3-MILE-007 (docs/examples/ops-manual sync):
  - `docs/sql-mile-007-docs-examples-regression-sync.md`
  - `docs/sql-p3-mile-007-docs-examples-operations-runbook-sync-report.md`
  - `test/unit-j-mile-007-docs-examples-regression-sync.ts`
  - `test/unit-p3-mile-007-docs-examples-operations-runbook-sync-acceptance.ts`
- Snapshot + example regression harness:
  - `examples/sql-compare-matrix.ts`
  - `examples/sql-semantic-grouped-runner.ts`
  - `examples/sql-logic-runner.ts`

## Troubleshooting
- If `tsx` is not available on PATH, prefer:
```bash
npm exec -- tsx <file>
```
- If SQLite compare fails, inspect generated MRE files under `reports/mre` and rerun `npm run sql:compare:matrix:category`.

## Artifacts
- Snapshot report: `reports/sql-compare-category.json`
- MRE outputs: `reports/mre/*.sql`
- Optional CI benchmark outputs: `reports/sql-performance-benchmark*.json`
