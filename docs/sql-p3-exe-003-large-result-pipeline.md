# P3-EXE-003 - Large Result-Set Pipelined Execution

## Scope

Implemented a Phase 3 pipelined `SELECT` execution path to avoid full intermediate materialization on non-blocking query shapes.

## What was added

- Added a pipelined row path in `src/client.ts` for eligible `SELECT` plans:
  - row-by-row predicate evaluation
  - row-by-row projection
  - early-stop when `OFFSET + LIMIT` is satisfied
- Added execution-mode gating to keep correctness:
  - `PIPELINED` when no blocking operators are present
  - `MATERIALIZED` fallback for blocking paths (`JOIN`, `GROUP BY`, aggregates, window row-number, or sort-required `ORDER BY`)
- Added runtime observability:
  - `getSelectExecutionPipelineStats(sql?)` accumulates execution counters and last-run details
  - `EXPLAIN` now surfaces:
    - `executionPipelineEligible`
    - `executionPipelineMode`
    - `executionPipelineBlockers`

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-exe-003-large-result-pipeline.ts`
- Regression:
  - `test/unit-c-exec-006-order-limit-stability.ts`
- Validation log (2026-03-20):
  - `reports/p3-exe-003-validation.log`
