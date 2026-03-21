# P2 Operations Runbook

## Scope
This runbook standardizes P2 transaction-consistency acceptance and daily verification flow.

## Prerequisites
- Node.js + npm installed
- Dependencies installed: `npm install`
- Run from repository root

## Recommended P2 Acceptance Flow
```bash
npm run build
npm run test:ci
npm run p2:bench:tpcc
npm run p2:bench:conflict
npm run p2:bench:longrun
npm run sql:logic
npm run sql:logic:p2
```

## Milestone Mapping
- P2-MILE-001 (ACID acceptance):
  - `test/unit-c-exec-010-transaction-atomic-commit.ts`
  - `test/unit-c-exec-011-transaction-rollback-consistency.ts`
  - `test/unit-g-stor-013-crash-recovery-wal-version-chain.ts`
- P2-MILE-002 (FK full path):
  - `test/unit-f-fk-003-insert-update-integrity.ts`
  - `test/unit-f-fk-004-on-delete-cascade.ts`
  - `test/unit-f-fk-005-on-delete-restrict-no-action.ts`
  - `test/unit-f-fk-006-on-update-cascade-restrict.ts`
  - `test/unit-f-fk-007-cycle-depth-protection.ts`
- P2-MILE-003 (Walrus version consistency):
  - `test/unit-g-stor-011-immutable-version-object-on-commit.ts`
  - `test/unit-g-stor-012-version-chain-metadata.ts`
  - `test/unit-g-stor-014-query-latest-committed-version.ts`
  - `test/unit-g-stor-015-pending-confirmed-read-strategy.ts`
- P2-MILE-004/005:
  - Bench scripts + full CI gate (`npm run ci:full`)

## Troubleshooting
- If `tsx` is not found in shell context, use:
```bash
npm exec -- tsx <file>
```
- Always prefer project-local toolchain via `npm run` / `npm exec`.

## Artifacts
- Benchmark outputs: `reports/sql-performance-benchmark*.json`
- Optional execution logs: `reports/p2-mile-run-*.log`
