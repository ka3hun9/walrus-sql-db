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

## Next milestones

1. **M0 (Phase A continue)**
   - DML with subquery predicates (`IN/EXISTS/ANY/ALL`) for UPDATE/DELETE
   - DDL surface hardening + deterministic error map for unsupported forms
   - constraint/index abstraction prep for PK/UNIQUE acceleration

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
