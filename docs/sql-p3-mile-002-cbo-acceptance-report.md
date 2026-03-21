# Milestone Acceptance Report: Cost-Based Optimizer

## P3-MILE-002

## Scope
- Milestone target: CBO acceptance in Phase 3.
- Required acceptance dimensions:
  - statistics-driven plan selection across selective and broad predicates;
  - cost-based join reorder with `GREEDY_CBO`;
  - plan stability fallback pin (`BAD_PLAN_FALLBACK_PIN`) after bad-plan trigger.

## Acceptance Gate
- Runtime gate test:
  - `test/unit-p3-mile-002-cbo-acceptance.ts`
- This gate validates:
  - optimizer statistics collection (`rowCount`, `NDV`, `NULL` count) and exposure;
  - explain-path divergence for selective (`BTREE_INDEX_LOOKUP`) vs broad (`TABLE_SCAN`) predicates;
  - join-order rewrite under CBO (`GREEDY_CBO`) for multi-table `INNER JOIN`;
  - bad-plan fallback pinning (`BAD_PLAN_FALLBACK_PIN`) while preserving query correctness.

## Validation Commands
- `npm run build`
- `npx tsx test/unit-p3-opt-002-statistics-collection-framework.ts`
- `npx tsx test/unit-p3-opt-004-predicate-selectivity-estimation-model.ts`
- `npx tsx test/unit-p3-opt-005-index-selection-strategy.ts`
- `npx tsx test/unit-p3-opt-006-join-reorder-cost-based.ts`
- `npx tsx test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- `npx tsx test/integration-p3-test-003-cbo-plan-selection-stability-regression.ts`
- `npx tsx test/unit-p3-mile-002-cbo-acceptance.ts`

## Result
- All validation commands pass.
- Milestone verdict: `PASS`.

## Recorded Output (2026-03-20)
- `npm run build`
  - `walrus-sql-db@0.3.0 build`
  - `npm run clean && tsc -p tsconfig.json`
- `npx tsx test/unit-p3-opt-002-statistics-collection-framework.ts`
  - `ok: P3-OPT-002 optimizer statistics collection framework`
- `npx tsx test/unit-p3-opt-004-predicate-selectivity-estimation-model.ts`
  - `ok: P3-OPT-004 predicate/composite predicate selectivity estimation model`
- `npx tsx test/unit-p3-opt-005-index-selection-strategy.ts`
  - `ok: P3-OPT-005 index selection strategy (table scan vs index scan vs index back-table)`
- `npx tsx test/unit-p3-opt-006-join-reorder-cost-based.ts`
  - `ok: P3-OPT-006 cost-based join reorder for INNER join chains`
- `npx tsx test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
  - `ok: P3-OPT-008 plan stability and bad-plan fallback`
- `npx tsx test/integration-p3-test-003-cbo-plan-selection-stability-regression.ts`
  - `ok: integration P3-TEST-003 CBO plan selection and plan-stability regression`
- `npx tsx test/unit-p3-mile-002-cbo-acceptance.ts`
  - `ok: P3-MILE-002 CBO acceptance (statistics-driven plan selection)`
