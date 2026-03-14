# SQL Gap Matrix (Current vs Target)

## Current snapshot (v0.4.x evolving)

| Area | Status | Notes |
|---|---|---|
| SELECT/WHERE/ORDER/LIMIT/OFFSET | ✅ | Baseline stable + 3VL filter semantics + expression first-cut (`+ - * / %`, CASE, COALESCE, NULLIF, CAST) + dialect gating for TOP/FETCH/LIMIT clause-shape by profile |
| Aggregates + GROUP BY/HAVING | ✅ | COUNT/SUM/AVG/MIN/MAX |
| JOIN | 🟡 | INNER/LEFT/RIGHT (first-cut) |
| Subquery | 🟡 | IN/EXISTS/scalar/ANY/ALL first-cut + correlated WHERE refs via `outer.<col>` + FROM subquery first-cut; scalar MIN-subquery NULL semantics aligned for current matrix |
| UNION | 🟡 | UNION / UNION ALL first-cut |
| Window | 🟡 | ROW_NUMBER first-cut |
| NULL/LIKE | ✅ | 3VL, IS NULL/IS NOT NULL, LIKE/NOT LIKE, LIKE ESCAPE + postgres `ILIKE` dialect-gated |
| Distinctness predicates | ✅ | IS DISTINCT FROM / IS NOT DISTINCT FROM |
| Boolean truth predicates | ✅ | IS [NOT] TRUE/FALSE/UNKNOWN |
| Transaction semantics | ❌ | Not implemented |
| Full SQL parser/AST | ❌ | Lightweight parser, not SQL-complete |
| Cost-based optimizer | ❌ | Not implemented |

## G5 completion snapshot (2026-03-14)

- Dialect profiles wired: `ansi | sqlite | postgres | mysql | sqlserver`
- Explicit leak guards in parser for:
  - keywords/clause forms (`TOP`, `FETCH`, sqlserver clause-shape)
  - identifier quoting (backtick/bracket)
  - functions (`IFNULL`, `ISNULL`, `IIF`, `DATE_TRUNC`, `PRINTF`)
  - operators (`ILIKE`, `REGEXP`, postgres regex operators)
  - CAST target dialect types (`UNSIGNED`, `NVARCHAR`, `BYTEA`, etc.)
- UNION tail execution now honors parser dialect constraints.
- Compare matrix includes `g5-fixture` category with PR + nightly reports.

## Phase A-1 snapshot (2026-03-14)

- Storage schema now tracks column type metadata from `CREATE TABLE`.
- SQL-92 core type parsing/validation added (including parameter checks):
  - `SMALLINT`, `INT`, `BIGINT`, `DECIMAL(p,s)`, `FLOAT`, `DOUBLE`, `CHAR(n)`, `VARCHAR(n)`, `DATE`, `TIME`, `TIMESTAMP`, `BOOLEAN`, `BLOB`
- Write-path type coercion + strict constraint enforcement enabled:
  - `PRIMARY KEY`, `NOT NULL`, `UNIQUE`
- Basic DDL mutation support added:
  - `DROP TABLE`
  - `ALTER TABLE ADD COLUMN`
  - `ALTER TABLE DROP COLUMN`
- Deterministic error families used in simulator layer:
  - `ERR_UNSUPPORTED_TYPE`, `ERR_TYPE_CONSTRAINT`, `ERR_CONSTRAINT_VIOLATION`, `ERR_UNSUPPORTED_DDL`

## Phase A-2 snapshot (2026-03-14)

- DML clause-shape improved:
  - `UPDATE ... SET ...` now supports omitted `WHERE` (applies to all rows)
  - `DELETE FROM ...` now supports omitted `WHERE` (deletes all rows)
- DDL deterministic unsupported handling tightened:
  - unsupported `ALTER TABLE` forms fail explicitly with `ERR_UNSUPPORTED_DDL`
- Added dedicated regression coverage for DML/DDL clause-shape behavior.

## Phase A-3 snapshot (2026-03-14)

- DML subquery predicate path validated for data modification:
  - `UPDATE ... WHERE ... IN (SELECT ...)`
  - `DELETE ... WHERE EXISTS (SELECT ... correlated ...)`
- malformed DML subquery shape continues to fail deterministically via `ERR_UNSUPPORTED_SUBQUERY`.
- Added dedicated regression for DML subquery behavior.

## Phase A-4 snapshot (2026-03-14)

- DML ANY/ALL subquery predicates validated on write paths:
  - `UPDATE ... WHERE expr >= ALL (SELECT ...)`
  - `DELETE ... WHERE expr < ANY (SELECT ...)`
- malformed ANY/ALL subquery forms continue deterministic failure with `ERR_UNSUPPORTED_SUBQUERY`.
- Added dedicated regression for ANY/ALL behavior in DML.

## Phase A-5 snapshot (2026-03-14)

- Unique/PK constraint path refactored toward index abstraction:
  - table-scoped unique maps introduced and rebuilt on write-path mutations (`INSERT/UPDATE/DELETE/ALTER/DROP`).
  - uniqueness checks in write validation now use indexed lookup path instead of full row scan.
- DDL unsupported boundary matrix extended (deterministic `ERR_UNSUPPORTED_DDL`):
  - e.g. unsupported `ALTER COLUMN`, `RENAME COLUMN`, duplicate `ADD COLUMN`.
- Added dedicated regression for DDL unsupported shapes + unique-index behavior after mutations.

## Phase A-6 snapshot (2026-03-14)

- Composite key constraints introduced in schema model:
  - table-level `PRIMARY KEY (c1, c2, ...)`
  - table-level `UNIQUE (c1, c2, ...)`
- Unique index abstraction extended from single-column to grouped key signatures.
- Write-path constraint checks now evaluate composite group uniqueness via indexed keys.
- Added dedicated composite key regression (including delete/reinsert reuse path).

## Phase A-7 snapshot (2026-03-14)

- Unique constraint index maintenance switched from full rebuild to incremental updates on hot write paths:
  - `INSERT`: add row keys only
  - `UPDATE`: replace affected row keys only
  - `DELETE`: remove matched row keys only
- Index map now stores row references directly, reducing index-to-row indirection.
- Full rebuild retained for structural DDL transitions (`ALTER`/schema changes) as a safe fallback.
- Added dedicated regression for incremental index maintenance across insert/update/delete + composite groups.

## Next milestones

1. **M0 (Phase A continue)**
   - join-aware DML planning prep (for future multi-table UPDATE/DELETE semantics)
   - constraint/index abstraction completion (cost model visibility + benchmark hooks)

2. **M1 (stabilize+)**
   - Join correctness test matrix
   - Complex where precedence + parentheses AST
   - Subquery edge cases + negative tests

3. **M2 (coverage)**
   - Correlated subquery
   - FROM subquery
   - Extra windows (RANK, DENSE_RANK)

4. **M3 (engine)**
   - Transaction model (simulator)
   - Index/plan optimization
   - Rich EXPLAIN plan tree
