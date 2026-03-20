# Milestone Acceptance Report: Large-Dataset Complex Query Performance and Stability

## P3-MILE-005

## Scope
- Milestone target: performance and stability acceptance for large-dataset complex queries in Phase 3.
- Required acceptance dimensions:
  - baseline/control/CBO benchmark chain shows measurable optimizer and indexing benefits;
  - large-dataset complex join/subquery workload remains observable and stable;
  - million-row pressure scenario preserves large scan-reduction benefit after index build;
  - long-run sustained-write scenario has zero consistency errors and bounded degradation.

## Acceptance Gate
- Runtime gate test:
  - `test/unit-p3-mile-005-large-dataset-performance-stability-acceptance.ts`
- This gate validates:
  - `P3-BENCH-001`: no-index baseline path stays `TABLE_SCAN` with positive throughput;
  - `P3-BENCH-002`: indexed same-load gains (`rowsVisitedReductionPct > 60`, positive `QPS`/`P95`/cost gains);
  - `P3-BENCH-003`: CBO preferred over fixed-rule baseline (`rowsVisitedReductionPct > 80`, cost reduction > 50%);
  - `P3-BENCH-004`: large dataset (`orders >= 20,000`) plus complex join/subquery evidence and stable result cardinality;
  - `P3-TEST-007`: million-row scan reduction ratio remains at least `10,000x`;
  - `P3-TEST-008`: long-run errors remain `0`, throughput floor is met, degradation ratio is under configured cap;
  - checklist and report synchronization for `P3-MILE-005`.

## Validation Commands
- `npm run build`
- `npx tsx test/unit-p3-mile-005-large-dataset-performance-stability-acceptance.ts`

## Result
- All validation commands pass.
- Milestone verdict: `PASS`.

## Recorded Output (2026-03-21)
- `npm run build`
  - `walrus-sql-db@0.3.0 build`
  - `npm run clean && tsc -p tsconfig.json`
- `npx tsx test/unit-p3-mile-005-large-dataset-performance-stability-acceptance.ts`
  - `ok: integration P3-TEST-008 long-run stability (consistency + performance threshold) -> reports/p3-test-008-longrun-stability-report.json`
  - `ok: integration P3-TEST-007 million-row index acceleration pressure -> reports/p3-test-007-million-row-index-acceleration-bench.json`
  - `ok: P3-MILE-005 large-dataset complex-query performance/stability acceptance`
