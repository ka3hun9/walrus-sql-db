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

## Phase A-8 snapshot (2026-03-14)

- Added constraint/index cost visibility APIs on simulator client:
  - `getConstraintIndexCost(table?)`
  - `resetConstraintIndexCost(table?)`
- Introduced cost counters for index maintenance path:
  - `insertOps`, `updateOps`, `deleteOps`, `rebuildOps`, `conflictChecks`, `rowsIndexed`
- Wired cost accumulation into incremental DML index maintenance + structural rebuild paths.
- Added regression to assert DML path stays rebuild-free and DDL path triggers rebuild counters.

## Phase A-9 snapshot (2026-03-14)

- Added constraint/index cost benchmark + gate scripts for CI integration:
  - `examples/sql-constraint-cost-benchmark.ts`
  - `examples/sql-constraint-cost-gate.ts`
- Added npm scripts:
  - `sql:constraint:cost:bench`
  - `sql:constraint:cost:gate`
- Benchmark emits report JSON (`reports/sql-constraint-cost.json`) with scenario-level counters.
- Gate enforces policy:
  - incremental DML path must keep `rebuildOps == 0`
  - structural ALTER path must produce `rebuildOps >= 1`

## Phase A-10 snapshot (2026-03-14)

- Introduced join-aware DML planning entry points:
  - `planUpdate(...)`
  - `planDelete(...)`
- Current planner policy is explicit and deterministic:
  - allows single-table `UPDATE/DELETE` path
  - rejects join-aware shapes (`UPDATE ... JOIN`, `UPDATE ... FROM`, `DELETE ... FROM ... JOIN`, `DELETE ... USING`) with existing error families (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`)
- Execution path now consumes plan objects (table/where + joinAware flag) to prepare for next-stage multi-table semantics.
- Added dedicated regression covering:
  - single-table compatibility
  - deterministic rejection of join-aware DML forms

## Phase A-11 snapshot (2026-03-14)

- Added first-cut join-aware UPDATE execution semantics for one minimal shape:
  - supported: `UPDATE <left> JOIN <right> ON <leftKey>=<rightKey> SET <col>=<expr> [WHERE ...]`
- Planner now distinguishes:
  - supported JOIN-update shape above
  - still-unsupported `UPDATE ... FROM ...` (deterministic `ERR_UNSUPPORTED_UPDATE`)
- Target-row derivation for first-cut JOIN-update:
  - derive left-table target row set from INNER JOIN matches (deduplicated)
  - apply existing write-path schema/constraint/index checks to those target rows
- Added dedicated regression for first-cut join-aware UPDATE + deterministic boundary retention.

## Phase A-12 snapshot (2026-03-14)

- Added first-cut join-aware DELETE execution semantics for minimal shape:
  - supported: `DELETE <left> FROM <left> JOIN <right> ON <leftKey>=<rightKey> [WHERE ...]`
- Planner now distinguishes:
  - supported JOIN-delete shape above (target must match left table)
  - still-unsupported `DELETE FROM ... USING ...` (deterministic `ERR_UNSUPPORTED_DELETE`)
- Target-row derivation for first-cut JOIN-delete:
  - derive left-table target set from INNER JOIN matches (deduplicated)
  - apply WHERE filtering on target-side rows
  - keep existing unique-index cleanup path on deleted rows
- Added dedicated regression for first-cut join-aware DELETE behavior + deterministic boundary retention.

## Phase A-13 snapshot (2026-03-14)

- Extended join-aware DML first-cut to support alias + qualified-field forms:
  - `UPDATE users u JOIN orders o ON u.id = o.user_id SET ... WHERE o.amount = ...`
  - `DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE ...`
  - qualified left-target `SET` forms (e.g., `SET u.tier = ...`) are accepted; right-side targets remain deterministic unsupported.
- Join planning now tracks optional `leftAlias/rightAlias` and feeds merged alias-qualified row views to WHERE evaluation.
- Deterministic boundaries retained:
  - `UPDATE ... FROM ...` remains unsupported (`ERR_UNSUPPORTED_UPDATE`)
  - `DELETE FROM ... USING ...` remains unsupported (`ERR_UNSUPPORTED_DELETE`)
  - DELETE target must match left table or left alias.
- Added dedicated alias/qualified regression and kept earlier join-aware phase regressions green.

## Phase A-15 snapshot (2026-03-14)

- Normalized join-aware DML ON-field binding semantics for deterministic alias/table-prefix behavior.
- Added strict ON-side prefix validation:
  - ON left expression may reference only left table/left alias (or unqualified column)
  - ON right expression may reference only right table/right alias (or unqualified column)
  - cross-side or malformed prefixes fail deterministically (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`).
- Join-aware UPDATE/DELETE row matching now evaluates WHERE over all matched join pairs per left row, then mutates/deletes each left row at most once.

## Phase A-16 snapshot (2026-03-14)

- Extended join-aware DML merged-row projection to include both alias-qualified and table-qualified keys simultaneously.
  - left side: `<leftAlias>.<col>` and `<leftTable>.<col>`
  - right side: `<rightAlias>.<col>` and `<rightTable>.<col>`
- This enables mixed-prefix SQL in ON/WHERE (table-prefix + alias-prefix combinations) to evaluate deterministically in first-cut join-aware UPDATE/DELETE.
- Added dedicated regression for mixed-prefix join-aware DML behavior and included it in grouped semantic runner.

## Phase A-17 snapshot (2026-03-14)

- Hardened join-aware DML parser boundaries around join-type forms:
  - explicit `INNER JOIN` now accepted for first-cut join-aware UPDATE/DELETE
  - non-inner forms (`LEFT/RIGHT/FULL [OUTER] JOIN`) are deterministically rejected
- This prevents accidental silent fallback on unsupported join semantics while keeping first-cut behavior explicit.
- Added regression coverage for both acceptance (`INNER JOIN`) and deterministic rejection (non-inner joins).

## Phase A-18 snapshot (2026-03-14)

- Added deterministic handling note + regression for overlapping column names in join-aware DML WHERE evaluation.
- Current first-cut behavior remains compatible with legacy expectations:
  - unqualified overlapping columns (e.g., `tier`) resolve to left/target row values in join-aware UPDATE/DELETE
  - right-side disambiguation remains available via qualified identifiers (e.g., `o.tier`, `orders.tier`)
- Added dedicated regression and grouped-runner coverage to lock this behavior and prevent accidental semantic drift.

## Phase A-19 snapshot (2026-03-14)

- Added deterministic join-ON field existence validation for join-aware DML:
  - UPDATE/DELETE now explicitly validate normalized ON left/right fields against table schemas before join matching.
  - missing left/right ON columns fail early with deterministic error-family (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`).
- Added dedicated regression covering invalid ON fields and valid-path confirmation.
- Included phaseA19 in grouped semantic runner.

## Phase A-20 snapshot (2026-03-14)

- Added deterministic alias-conflict guard for join-aware UPDATE/DELETE planning.
- Rejects conflicting cross-side naming (left table/alias collides with right table/alias), while preserving no-alias and normal distinct-alias forms.
- Added phaseA20 regression and grouped-runner coverage.

## Phase A-21 snapshot (2026-03-14)

- Added deterministic self-join boundary for first-cut join-aware UPDATE/DELETE planning.
- Self-join forms (`leftTable == rightTable`) are now explicitly rejected with existing unsupported error family.
- Keeps behavior explicit and prevents ambiguous semantics before dedicated self-join execution model exists.
- Added dedicated phaseA21 regression and grouped-runner coverage.

## Phase A-22 snapshot (2026-03-14)

- Added regression lock for explicit `AS` alias forms in first-cut join-aware DML:
  - `UPDATE <table> AS <alias> INNER JOIN ...`
  - `DELETE <alias> FROM <table> AS <alias> INNER JOIN ...`
- Confirms parity between `AS` aliases and bare aliases under current join-aware planner/executor behavior.
- Keeps deterministic boundaries intact (e.g., invalid DELETE target alias still rejected).
- Included phaseA22 in grouped semantic runner.

## Phase A-23 snapshot (2026-03-14)

- Added regression lock that join-aware UPDATE writes continue to enforce left-table UNIQUE constraints.
- Coverage ensures conflict paths raise `ERR_CONSTRAINT_VIOLATION` and non-conflicting join-aware updates still succeed.
- Included phaseA23 in grouped semantic runner.

## Phase A-24 snapshot (2026-03-14)

- Added regression lock that join-aware UPDATE writes keep enforcing left-table type constraints (`ERR_TYPE_CONSTRAINT`).
- Verifies invalid typed writes are rejected while valid typed writes still succeed in join-aware execution path.
- Included phaseA24 in grouped semantic runner.

## Phase A-25 snapshot (2026-03-14)

- Added regression lock that join-aware UPDATE writes preserve NOT NULL enforcement on left-table targets.
- Confirms NULL writes fail with `ERR_CONSTRAINT_VIOLATION` while valid non-null updates succeed.
- Included phaseA25 in grouped semantic runner.

## Phase A-26 snapshot (2026-03-14)

- Added regression lock for join-aware DELETE unique-index cleanup correctness on left-table target.
- Confirms keys released by join-aware DELETE can be deterministically reused by subsequent INSERT.
- Included phaseA26 in grouped semantic runner.

## Phase A-27 snapshot (2026-03-14)

- Added regression lock that join-aware UPDATE enforces composite UNIQUE groups on left-table writes.
- Verifies conflicting writes raise `ERR_CONSTRAINT_VIOLATION` and non-conflicting writes remain successful.
- Included phaseA27 in grouped semantic runner.

## Phase A-28 snapshot (2026-03-14)

- Added regression lock for join-aware DELETE cleanup on composite UNIQUE groups.
- Confirms composite key tuples released by join-aware DELETE are reusable by subsequent INSERT.
- Included phaseA28 in grouped semantic runner.

## Phase A-29 snapshot (2026-03-14)

- Added regression lock for constraint/index cost-path behavior under join-aware DML hot path.
- Verifies join-aware UPDATE/DELETE mutate counters (`updateOps`, `deleteOps`) while keeping `rebuildOps == 0`.
- Included phaseA29 in grouped semantic runner.

## Phase A-30 snapshot (2026-03-14)

- Added regression lock for conflict-path constraint/index cost behavior under join-aware UPDATE.
- Verifies UNIQUE-conflict path increments `conflictChecks` and does not trigger structural index rebuild (`rebuildOps == 0`).
- Included phaseA30 in grouped semantic runner.

## Phase A-31 snapshot (2026-03-14)

- Added regression lock for join-aware DML constraint-cost isolation to left/target table only.
- Verifies join-aware UPDATE/DELETE mutate left-table cost counters while right-table counters remain unchanged.
- Included phaseA31 in grouped semantic runner.

## Phase A-32 snapshot (2026-03-14)

- Added regression lock for no-op stability on join-aware DML cost path.
- Verifies join-aware UPDATE/DELETE with non-matching WHERE produce no row mutation and keep cost counters stable (`updateOps=0`, `deleteOps=0`, `rebuildOps=0`).
- Included phaseA32 in grouped semantic runner.

## Phase A-33 snapshot (2026-03-14)

- Added regression lock for no-op cost isolation in join-aware DML.
- Verifies no-op join-aware UPDATE/DELETE keep both left-table mutation counters and right-table cost counters unchanged.
- Included phaseA33 in grouped semantic runner.

## Phase A-34 snapshot (2026-03-14)

- Added regression lock for join-aware DML multi-match target behavior on constraint-cost path.
- Validates row-level mutation dedup semantics functionally (single left-row result change) while preserving deterministic non-rebuild cost behavior.
- Included phaseA34 in grouped semantic runner.

## Phase A-35 snapshot (2026-03-14)

- Added regression lock for join-aware UPDATE conflict-path state stability.
- Verifies UNIQUE-conflict failure keeps row state unchanged while preserving deterministic cost behavior (`conflictChecks > 0`, `deleteOps = 0`, `rebuildOps = 0`).
- Included phaseA35 in grouped semantic runner.

## Phase A-36 snapshot (2026-03-14)

- Added regression lock for join-aware DELETE cost semantics with respect to conflict checking.
- Verifies DELETE path mutates delete counters without introducing uniqueness conflict-check cost, and keeps `rebuildOps = 0`.
- Included phaseA36 in grouped semantic runner.

## Next milestones

1. **M0 (Phase A continue)**
   - extend join-aware DML semantics coverage (outer-join/alias variants + deterministic boundaries)
   - promote constraint/index cost gate into primary CI workflow + threshold tuning from nightly trend

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
