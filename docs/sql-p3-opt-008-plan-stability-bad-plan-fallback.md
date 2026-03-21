# P3-OPT-008 - Plan Stability and Bad-Plan Fallback

## Scope

Implemented Phase 3 optimizer plan-stability policy with runtime bad-plan fallback for SELECT execution paths.

## What was added

- Plan-stability state tracking per normalized SELECT SQL:
  - preferred stable access path (`method/index`)
  - fallback cooldown window for bad plans
  - counters (`executions`, `badPlanFallbackCount`, `stablePinCount`, `planSwitchCount`)
- Physical planner now keeps:
  - `optimizerChosen` (pure cost-based winner)
  - `chosen` (after stability/fallback policy)
  - `stabilityReason` (`NONE` / `PLAN_STABILITY_PIN` / `BAD_PLAN_FALLBACK_PIN`)
- Runtime feedback loop:
  - detects low-selectivity index plans (high scan ratio + high row-retention ratio)
  - activates temporary `TABLE_SCAN` pin as fallback
- New observability API:
  - `getSelectPlanStability(sql?)`
- `EXPLAIN` output extended with stability/fallback fields:
  - optimizer-vs-final access path
  - stability reason/pinned flag
  - fallback counters and remaining cooldown

## Validation

- Build:
  - `npm run build`
- Unit:
  - `test/unit-p3-opt-008-plan-stability-bad-plan-fallback.ts`
- Regression:
  - `test/unit-p3-opt-001-logical-physical-plan-layering.ts`
  - `test/unit-p3-idx-004-btree-range-order-path.ts`
- Validation log (2026-03-19):
  - `reports/p3-opt-008-validation.log`
