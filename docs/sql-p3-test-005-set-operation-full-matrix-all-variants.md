# P3-TEST-005 - Set-Operation Full Matrix Integration (Including ALL Variants)

## Scope

Added dedicated Phase 3 integration coverage for full set-operation behavior across:
- `UNION` / `UNION ALL`
- `INTERSECT` / `INTERSECT ALL`
- `EXCEPT` / `EXCEPT ALL`
- chained mixed set operations that include `ALL` variants

## What Was Validated

- Distinct vs multiset semantics are correct for all three set-operation families.
- Row identity for set operations is evaluated on full projection shape (`id, tag`) rather than a single key.
- `ALL` variants preserve multiplicity according to multiset rules:
  - `UNION ALL`: additive cardinality
  - `INTERSECT ALL`: `min(left_count, right_count)`
  - `EXCEPT ALL`: `max(left_count - right_count, 0)`
- Chained mixed set-op execution remains correct when `ALL` variants appear in the chain.

## Validation

- Integration: `test/integration-p3-test-005-set-operation-full-matrix-all-variants.ts`
