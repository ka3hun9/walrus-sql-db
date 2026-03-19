# P3-TEST-002 - Statistics Collection, Persistence, and Recovery

## Scope

Added dedicated Phase 3 unit coverage for optimizer statistics lifecycle across live collection, versioned persistence, and WAL/version-chain recovery.

## What Was Validated

- Live statistics collection reflects committed table rows (`rowCount`, NDV, NULL count).
- Committed transaction writes persist immutable optimizer stats version objects.
- WAL-prepared but uncommitted writes do not mutate live/persisted stats before recovery.
- Recovery with `pendingStrategy: "replay"` applies pending writes and advances stats version history.
- Recovery with `pendingStrategy: "rollback"` discards pending writes and preserves prior stats history.
- Recovered row state and recovered stats (`live` + `versioned`) remain consistent.

## Validation

- Unit: `test/unit-p3-test-002-statistics-collection-persistence-recovery.ts`
