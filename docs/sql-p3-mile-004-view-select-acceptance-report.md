# Milestone Acceptance Report: View SELECT Capability

## P3-MILE-004

## Scope
- Milestone target: view `SELECT` capability acceptance in Phase 3.
- Required acceptance dimensions:
  - view `SELECT` path supports filtering, ordering, aggregation, and join usage;
  - chained view expansion keeps stable projection behavior under read workloads;
  - dependency invalidation blocks `SELECT` on invalid views with deterministic error messages;
  - updatable views remain deferred with deterministic `ERR_UNSUPPORTED_INSERT` / `ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE` boundaries.

## Acceptance Gate
- Runtime gate test:
  - `test/unit-p3-mile-004-view-select-acceptance.ts`
- This gate validates:
  - view query correctness across `WHERE` + `ORDER BY` + aggregate + join;
  - chained view read-path correctness and dependency invalidation after base-column drop;
  - read-only boundary for view writes and no unintended mutation after rejected writes;
  - checklist and report synchronization for `P3-MILE-004`.

## Validation Commands
- `npm run build`
- `npx tsx test/unit-p3-view-003-select-on-view.ts`
- `npx tsx test/unit-p3-view-004-view-dependency-invalidation.ts`
- `npx tsx test/unit-p3-view-005-view-permission-naming-conflict-policy.ts`
- `npx tsx test/unit-p3-view-006-updatable-view-deferred-boundary-error-codes.ts`
- `npx tsx test/integration-p3-test-006-view-expansion-dependency-change-regression.ts`
- `npx tsx test/unit-p3-mile-004-view-select-acceptance.ts`

## Result
- All validation commands pass.
- Milestone verdict: `PASS`.

## Recorded Output (2026-03-20)
- `npm run build`
  - `walrus-sql-db@0.3.0 build`
  - `npm run clean && tsc -p tsconfig.json`
- `npx tsx test/unit-p3-view-003-select-on-view.ts`
  - `ok: P3-VIEW-003 select on view with filter/order/aggregate/join`
- `npx tsx test/unit-p3-view-004-view-dependency-invalidation.ts`
  - `ok: P3-VIEW-004 view dependency analysis and invalidation detection`
- `npx tsx test/unit-p3-view-005-view-permission-naming-conflict-policy.ts`
  - `ok: P3-VIEW-005 view permission and naming conflict baseline policy`
- `npx tsx test/unit-p3-view-006-updatable-view-deferred-boundary-error-codes.ts`
  - `ok: P3-VIEW-006 updatable-view deferred boundary and error-code contract`
- `npx tsx test/integration-p3-test-006-view-expansion-dependency-change-regression.ts`
  - `ok: integration P3-TEST-006 view expansion and dependency-change regression`
- `npx tsx test/unit-p3-mile-004-view-select-acceptance.ts`
  - `ok: P3-MILE-004 view SELECT acceptance (updatable views deferred)`
