# SQL-92 Suite Bootstrap Report

## P4-BOOT-001

## Scope
- Objective: wire Phase-4 SQL-92 suite execution before feature completion, and keep it reusable.
- Minimal executable subset in this boot item:
  - window-function path (`ROW_NUMBER() OVER (...)`) as passing cases;
  - CTE path (`WITH` / `WITH RECURSIVE`) as deterministic expected-error baseline until CTE execution lands.

## Reusable Execution Framework
- Runner script:
  - `examples/sql-logic-suite-runner.ts`
- Manifest-driven suite definition:
  - `test/sqllogic/suites/p4-boot-001-minimal.json`
- Fixture files:
  - `test/sqllogic/sql92-p4-window-core.slt`
  - `test/sqllogic/sql92-p4-cte-baseline.slt`

## Report Path
- Canonical report output for this item:
  - `reports/sql92-p4-boot-001-minimal.json`

## Commands
- `npm run build`
- `npm run sql:logic:suite -- test/sqllogic/suites/p4-boot-001-minimal.json reports/sql92-p4-boot-001-minimal.json`
- `npm run sql:logic:p4:boot`
- `npx tsx test/unit-p4-boot-001-sql92-suite-bootstrap.ts`

## Result
- Suite bootstrap runner executes manifest entries and writes JSON report successfully.
- Window subset passes.
- CTE baseline is tracked through expected-error cases (suite remains green).
- Verdict: `PASS`.
