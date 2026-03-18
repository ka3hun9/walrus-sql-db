# P3-IDX-003 — Hash Index Structure (Equality Query Path)

## Scope

Implemented baseline hash index structure for equality predicate acceleration on single-column HASH indexes in simulator mode.

## What was added

- Query path prefilter for single-table SELECT with `WHERE <col> = <literal>`:
  - Detects candidate equality clauses from parsed `whereClauses`
  - Resolves matching ACTIVE HASH index entries from index catalog
  - Narrows scan rows to hash-bucket hits before full predicate evaluation
- Hash index rebuild path:
  - Rebuilds per table using catalog metadata (`type=HASH`, `status=ACTIVE`, single-column)
  - Tracks bucket/key stats in `hashIndexStats`
- Commit/recovery lifecycle integration:
  - Transaction commit apply path rebuilds hash indexes for touched table
  - WAL/version-chain recovery path rebuilds hash indexes after restoring rows
  - DDL create/drop table path clears hash index runtime state
- Observability:
  - `getHashIndexStats(table?)` API for keys/rowsIndexed visibility

## Current constraints

- Equality path currently targets:
  - single-table SELECT (no JOIN/JOINS path)
  - single-column HASH indexes
  - literal equality clauses (`=`)
- Non-matching or unsupported predicates automatically fall back to existing full scan/filter path.

## Validation

- Unit: `test/unit-p3-idx-003-hash-index-eq-path.ts`
- Benchmark sample: `examples/p3-bench-idx-003-hash-eq.ts`
  - report output: `reports/p3-idx-003-hash-eq.json`
