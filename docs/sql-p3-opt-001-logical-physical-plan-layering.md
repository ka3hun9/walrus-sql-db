# P3-OPT-001 - Logical/Physical Plan Layering

## Scope

Implemented a two-layer SELECT planner in Phase 3 scope:
- Logical plan stage with rewrite-rule tracking.
- Physical plan stage with cost-based access-path selection.

## What was added

- New logical-plan model in `src/client.ts`:
  - canonical join-chain view
  - predicate-source selection (`AST` / `TREE` / `CLAUSES` / `NONE`)
  - rewrite-rule tracking (`RULE_CANONICALIZE_JOIN_CHAIN`, `RULE_PREFER_AST_PREDICATE`, `RULE_NORMALIZE_ORDER_BY_DIRECTION`)
- New physical-plan model in `src/client.ts`:
  - access-path candidates: `TABLE_SCAN`, `HASH_INDEX_LOOKUP`, `BTREE_INDEX_LOOKUP`, `BTREE_ORDERED_SCAN`
  - per-candidate estimated rows/cost
  - deterministic best-path selection
- SELECT execution now uses planner output:
  - build logical plan
  - evaluate physical candidates with cost
  - execute with chosen access path
- `EXPLAIN` output extended with optimizer details:
  - logical rewrite list, predicate source, join count
  - chosen physical access path, estimated cost/rows, order satisfaction
  - candidate summary string
- Index lookup observability preserved by tracking exactly one chosen index path per query.

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
- Regression checks:
  - `test/unit-p3-idx-004-btree-range-order-path.ts`
  - `test/unit-p3-idx-008-index-observability-metrics.ts`
  - `test/unit-c-exec-006-order-limit-stability.ts`
- Validation log (2026-03-19): `reports/p3-opt-001-validation.log`
