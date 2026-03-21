# P3-IDX-004 — BTREE Index Structure (Range/Order Query Path)

## Scope

Implemented baseline BTREE index runtime for simulator mode, focused on single-column range filtering and single-key ordering paths.

## What was added

- BTREE index runtime structure and rebuild path:
  - materializes ordered leaf entries from active catalog entries (`type=BTREE`, single-column)
  - tracks stats in `getBtreeIndexStats(table?)`
- DDL execution support for index lifecycle:
  - `CREATE INDEX` adds BTREE catalog entry
  - `DROP INDEX` removes catalog entry (with `IF EXISTS` behavior)
  - internal synthetic constraint indexes are protected from explicit drop
- Query acceleration path:
  - range prefilter for single-table predicates on indexed column:
    - `=`, `>`, `>=`, `<`, `<=`, `BETWEEN`
  - ORDER BY path for single-key order:
    - scans BTREE entries directly in `ASC` / `DESC`
    - keeps `NULL` values at the tail (`NULLS LAST`) to match executor behavior
- Lifecycle integration:
  - rebuilds secondary indexes on commit apply and WAL/version-chain recovery
  - rebuilds/cleans index metadata during ALTER column shape changes

## Current constraints

- Execution path currently supports single-column BTREE indexes.
- BTREE scan path is single-table only (no JOIN path acceleration).
- Range predicate extraction is conjunction-based; `OR` falls back to existing scan/filter.
- ORDER BY fast path is single-key only.

## Validation

- Unit: `test/unit-p3-idx-004-btree-range-order-path.ts`
- Benchmark: `test/unit-p3-idx-004-btree-index-bench.ts`
  - report output: `reports/p3-idx-004-btree-index-bench.json`
