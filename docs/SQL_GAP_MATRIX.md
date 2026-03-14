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

## Phase A-37 snapshot (2026-03-14)

- Added regression lock for join-aware UPDATE conflict-path cost isolation across join sides.
- Verifies left-table conflict checks are recorded while right-table cost counters remain unchanged.
- Included phaseA37 in grouped semantic runner.

## Phase A-38 snapshot (2026-03-14)

- Added regression lock for join-aware DELETE cost isolation across join sides.
- Verifies left-table delete-path counters mutate as expected while right-table counters remain unchanged.
- Keeps deterministic delete-path invariants (`conflictChecks = 0`, `rebuildOps = 0`).
- Included phaseA38 in grouped semantic runner.

## Phase A-39 snapshot (2026-03-14)

- Added regression lock for unsupported join-type rejection cost stability (`LEFT JOIN` path for join-aware UPDATE/DELETE).
- Verifies deterministic unsupported errors are raised and both left/right constraint-cost counters remain unchanged.
- Included phaseA39 in grouped semantic runner.

## Phase A-40 snapshot (2026-03-14)

- Added regression lock for unsupported `RIGHT JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and no mutation to left/right constraint-cost counters.
- Included phaseA40 in grouped semantic runner.

## Phase A-41 snapshot (2026-03-14)

- Added regression lock for unsupported `FULL JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA41 in grouped semantic runner.

## Phase A-42 snapshot (2026-03-14)

- Added regression lock for unsupported `FULL OUTER JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA42 in grouped semantic runner.

## Phase A-43 snapshot (2026-03-14)

- Added regression lock for unsupported `LEFT OUTER JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA43 in grouped semantic runner.

## Phase A-44 snapshot (2026-03-14)

- Added regression lock for unsupported `RIGHT OUTER JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA44 in grouped semantic runner.

## Phase A-45 snapshot (2026-03-14)

- Added regression lock for unsupported `CROSS JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA45 in grouped semantic runner.

## Phase A-46 snapshot (2026-03-14)

- Added regression lock for unsupported alternative DML join shapes cost stability:
  - `UPDATE ... FROM ...`
  - `DELETE ... USING ...`
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA46 in grouped semantic runner.

## Phase A-47 snapshot (2026-03-14)

- Added regression lock for explicit `INNER JOIN` hot-path behavior in join-aware UPDATE/DELETE cost path.
- Verifies supported `INNER JOIN` flow mutates left-table counters (`updateOps`/`deleteOps`) with `rebuildOps = 0`, while right-table counters remain unchanged.
- Included phaseA47 in grouped semantic runner.

## Phase A-48 snapshot (2026-03-14)

- Added regression lock for implicit `JOIN` (without `INNER` keyword) hot-path behavior in join-aware UPDATE/DELETE cost path.
- Verifies supported implicit-join flow mutates left-table counters (`updateOps`/`deleteOps`) with `rebuildOps = 0`, while right-table counters remain unchanged.
- Included phaseA48 in grouped semantic runner.

## Phase A-49 snapshot (2026-03-14)

- Added regression lock for unsupported `NATURAL JOIN` rejection cost stability in join-aware UPDATE/DELETE.
- Verifies deterministic unsupported errors and unchanged left/right constraint-cost counters.
- Included phaseA49 in grouped semantic runner.

## Phase A-50 snapshot (2026-03-14)

- Added regression lock for ON-side reversed field ordering (`o.user_id = u.id`) in join-aware UPDATE/DELETE.
- Confirms current deterministic behavior: reversed ON-side ordering is rejected (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) with no constraint-cost side effects.
- Included phaseA50 in grouped semantic runner.

## Phase A-51 snapshot (2026-03-14)

- Added regression lock for unqualified ON fields (`ON id = user_id`) in join-aware UPDATE/DELETE.
- Confirms deterministic supported behavior for unambiguous unqualified ON fields: left-table cost counters move (`updateOps`/`deleteOps`), `rebuildOps = 0`, right-table counters unchanged.
- Included phaseA51 in grouped semantic runner.

## Phase A-52 snapshot (2026-03-14)

- Added regression lock for same-name unqualified ON fields (`ON id = id`) in join-aware UPDATE/DELETE.
- Confirms current deterministic behavior: this shape follows the supported hot path, mutating left-table counters (`updateOps`/`deleteOps`) with `rebuildOps = 0`, while right-table counters remain unchanged.
- Included phaseA52 in grouped semantic runner.

## Phase A-53 snapshot (2026-03-14)

- Added regression lock for invalid ON field shape (`table.column.extra`) rejection in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA53 in grouped semantic runner.

## Phase A-54 snapshot (2026-03-14)

- Added regression lock for ON prefix cross-side misuse in join-aware UPDATE/DELETE:
  - left ON side prefixed with right alias (`o.user_id = o.id`)
  - right ON side prefixed with left alias (`u.id = u.id`)
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA54 in grouped semantic runner.

## Phase A-55 snapshot (2026-03-14)

- Added regression lock for ON field-to-literal shape rejection (`ON u.id = 1`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA55 in grouped semantic runner.

## Phase A-56 snapshot (2026-03-14)

- Added regression lock for ON expression shape rejection (non field=field), e.g. `ABS(u.id) = o.user_id`.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA56 in grouped semantic runner.

## Phase A-57 snapshot (2026-03-14)

- Added regression lock for conflicting join aliases (left and right alias both `u`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA57 in grouped semantic runner.

## Phase A-58 snapshot (2026-03-14)

- Added regression lock for right alias conflicting with left table name (e.g. `JOIN orders users`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA58 in grouped semantic runner.

## Phase A-59 snapshot (2026-03-14)

- Added regression lock for left alias conflicting with right table name (e.g. `UPDATE users orders JOIN orders o ...`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA59 in grouped semantic runner.

## Phase A-60 snapshot (2026-03-14)

- Added regression lock for target alias conflicting with left table name (e.g. `UPDATE users u JOIN orders users ... SET users.tier = ...`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA60 in grouped semantic runner.

## Phase A-61 snapshot (2026-03-14)

- Added regression lock for non-left target alias writes (e.g. `SET o.amount = ...` / `DELETE o ...`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA61 in grouped semantic runner.

## Phase A-62 snapshot (2026-03-14)

- Added regression lock for left-table-name target usage while left alias exists (e.g. `SET users.tier = ...` / `DELETE users ...`) in join-aware UPDATE/DELETE.
- Confirms current deterministic behavior: this shape follows supported hot path (left-table mutation only), with left-table counters moving (`updateOps`/`deleteOps`) and `rebuildOps = 0`, while right-table counters remain unchanged.
- Included phaseA62 in grouped semantic runner.

## Phase A-63 snapshot (2026-03-14)

- Added regression lock for non-left target table writes (e.g. `SET orders.amount = ...` / `DELETE orders ...`) in join-aware UPDATE/DELETE.
- Confirms deterministic unsupported errors (`ERR_UNSUPPORTED_UPDATE` / `ERR_UNSUPPORTED_DELETE`) and zero constraint-cost side effects on both tables.
- Included phaseA63 in grouped semantic runner.

## Phase A-64 snapshot (2026-03-14)

- Added regression lock for mixed-target UPDATE + multi-target DELETE shapes in join-aware DML:
  - `SET u.tier = ..., o.amount = ...`
  - `DELETE u, o ...`
- Confirms deterministic behavior boundary:
  - mixed-target UPDATE currently fails with `ERR_TYPE_CONSTRAINT`
  - multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA64 in grouped semantic runner.

## Phase A-65 snapshot (2026-03-14)

- Added regression lock for mixed table-name targets in join-aware DML boundary:
  - `UPDATE ... SET users.tier = ..., orders.amount = ...`
  - `DELETE users, o ...`
- Confirms deterministic behavior boundary:
  - mixed table-name UPDATE currently fails with `ERR_TYPE_CONSTRAINT`
  - mixed multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA65 in grouped semantic runner.

## Phase A-66 snapshot (2026-03-14)

- Added regression lock for mixed table-name targets without aliases in join-aware DML boundary:
  - `UPDATE users JOIN orders ... SET users.tier = ..., orders.amount = ...`
  - `DELETE users, orders FROM users JOIN orders ...`
- Confirms deterministic behavior boundary:
  - mixed no-alias UPDATE currently fails with `ERR_TYPE_CONSTRAINT`
  - multi-target table-name DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA66 in grouped semantic runner.

## Phase A-67 snapshot (2026-03-14)

- Added regression lock for right-first mixed SET ordering in join-aware DML boundary:
  - `UPDATE users u JOIN orders o ... SET o.amount = ..., u.tier = ...`
  - `DELETE o, u FROM users u JOIN orders o ...`
- Confirms deterministic behavior boundary:
  - right-first mixed SET rejects with `ERR_UNSUPPORTED_UPDATE` and explicit target-side message (`SET target must reference left table/alias: o.amount`)
  - reversed-order multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA67 in grouped semantic runner.

## Phase A-68 snapshot (2026-03-14)

- Added regression lock for right-first mixed table-name SET ordering (no aliases) in join-aware DML boundary:
  - `UPDATE users JOIN orders ... SET orders.amount = ..., users.tier = ...`
  - `DELETE orders, users FROM users JOIN orders ...`
- Confirms deterministic behavior boundary:
  - right-first mixed table-name SET rejects with `ERR_UNSUPPORTED_UPDATE` and explicit target-side message (`SET target must reference left table/alias: orders.amount`)
  - reversed-order table-name multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA68 in grouped semantic runner.

## Phase A-69 snapshot (2026-03-14)

- Added regression lock for right table-name targets when right side is aliased in join-aware DML boundary:
  - `UPDATE users u JOIN orders o ... SET orders.amount = ..., u.tier = ...`
  - `DELETE orders, u FROM users u JOIN orders o ...`
- Confirms deterministic behavior boundary:
  - right table-name target with right alias rejects via `ERR_UNSUPPORTED_UPDATE` and explicit target-side message (`SET target must reference left table/alias: orders.amount`)
  - mixed table-name+alias multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA69 in grouped semantic runner.

## Phase A-70 snapshot (2026-03-14)

- Added regression lock for mixed right-alias + left-table-name targets in join-aware DML boundary:
  - `UPDATE users u JOIN orders o ... SET o.amount = ..., users.tier = ...`
  - `DELETE o, users FROM users u JOIN orders o ...`
- Confirms deterministic behavior boundary:
  - right alias target in mixed SET rejects with `ERR_UNSUPPORTED_UPDATE` and explicit target-side message (`SET target must reference left table/alias: o.amount`)
  - mixed alias+table-name multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA70 in grouped semantic runner.

## Phase A-71 snapshot (2026-03-14)

- Added regression lock for left-first mixed targets where right table-name is used while right side is aliased:
  - `UPDATE users u JOIN orders o ... SET u.tier = ..., orders.amount = ...`
  - `DELETE users, o FROM users u JOIN orders o ...`
- Confirms deterministic behavior boundary:
  - left-first mixed SET with right table-name target currently fails with `ERR_TYPE_CONSTRAINT`
  - mixed table-name+alias multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA71 in grouped semantic runner.

## Phase A-72 snapshot (2026-03-14)

- Added regression lock for mixed left table-name + right alias targets in join-aware DML boundary:
  - `UPDATE users u JOIN orders o ... SET users.tier = ..., o.amount = ...`
  - `DELETE users, o FROM users u JOIN orders o ...`
- Confirms deterministic behavior boundary:
  - mixed SET with right alias target currently fails with `ERR_TYPE_CONSTRAINT`
  - mixed table-name+alias multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA72 in grouped semantic runner.

## Phase A-73 snapshot (2026-03-14)

- Added regression lock for backtick-quoted target shapes in join-aware DML boundary:
  - `UPDATE ... SET `o`.`amount` = ..., `u`.`tier` = ...`
  - `DELETE `o`, `u` FROM ...`
- Confirms deterministic behavior boundary:
  - backtick-quoted mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - backtick-quoted multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA73 in grouped semantic runner.

## Phase A-74 snapshot (2026-03-14)

- Added regression lock for double-quoted target shapes in join-aware DML boundary:
  - `UPDATE ... SET "o"."amount" = ..., "u"."tier" = ...`
  - `DELETE "o", "u" FROM ...`
- Confirms deterministic behavior boundary:
  - double-quoted mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - double-quoted multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA74 in grouped semantic runner.

## Phase A-75 snapshot (2026-03-14)

- Added regression lock for bracket-quoted target shapes in join-aware DML boundary:
  - `UPDATE ... SET [o].[amount] = ..., [u].[tier] = ...`
  - `DELETE [o], [u] FROM ...`
- Confirms deterministic behavior boundary:
  - bracket-quoted mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - bracket-quoted multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA75 in grouped semantic runner.

## Phase A-76 snapshot (2026-03-14)

- Added regression lock for single-quoted pseudo-identifier target shapes in join-aware DML boundary:
  - `UPDATE ... SET 'o'.'amount' = ..., 'u'.'tier' = ...`
  - `DELETE 'o', 'u' FROM ...`
- Confirms deterministic behavior boundary:
  - single-quoted mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - single-quoted multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA76 in grouped semantic runner.

## Phase A-77 snapshot (2026-03-14)

- Added regression lock for spaced target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o . amount = ..., u . tier = ...`
  - `DELETE o , u FROM ...`
- Confirms deterministic behavior boundary:
  - spaced mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - spaced multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA77 in grouped semantic runner.

## Phase A-78 snapshot (2026-03-14)

- Added regression lock for newline-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\n.\namount = ..., u\n.\ntier = ...`
  - `DELETE o,\n u FROM ...`
- Confirms deterministic behavior boundary:
  - newline-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - newline-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA78 in grouped semantic runner.

## Phase A-79 snapshot (2026-03-14)

- Added regression lock for tab-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\t.\tamount = ..., u\t.\ttier = ...`
  - `DELETE o,\t u FROM ...`
- Confirms deterministic behavior boundary:
  - tab-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - tab-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA79 in grouped semantic runner.

## Phase A-80 snapshot (2026-03-14)

- Added regression lock for carriage-return-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\r.\ramount = ..., u\r.\rtier = ...`
  - `DELETE o,\r u FROM ...`
- Confirms deterministic behavior boundary:
  - carriage-return-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - carriage-return-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA80 in grouped semantic runner.

## Phase A-81 snapshot (2026-03-14)

- Added regression lock for CRLF-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\r\n.\r\namount = ..., u\r\n.\r\ntier = ...`
  - `DELETE o,\r\n u FROM ...`
- Confirms deterministic behavior boundary:
  - CRLF-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - CRLF-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA81 in grouped semantic runner.

## Phase A-82 snapshot (2026-03-14)

- Added regression lock for form-feed-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\f.\famount = ..., u\f.\ftier = ...`
  - `DELETE o,\f u FROM ...`
- Confirms deterministic behavior boundary:
  - form-feed-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - form-feed-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA82 in grouped semantic runner.

## Phase A-83 snapshot (2026-03-14)

- Added regression lock for vertical-tab-broken target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o\v.\vamount = ..., u\v.\vtier = ...`
  - `DELETE o,\v u FROM ...`
- Confirms deterministic behavior boundary:
  - vertical-tab-broken mixed SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - vertical-tab-broken multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA83 in grouped semantic runner.

## Phase A-84 snapshot (2026-03-14)

- Added regression lock for mixed tab+newline target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o \t.\n amount = ..., u \t.\n tier = ...`
  - `DELETE o,\t\n u FROM ...`
- Confirms deterministic behavior boundary:
  - mixed tab+newline target-token SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - mixed tab+newline multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA84 in grouped semantic runner.

## Phase A-85 snapshot (2026-03-14)

- Added regression lock for repeated-space target-token shapes in join-aware DML boundary:
  - `UPDATE ... SET o  .   amount = ..., u  .   tier = ...`
  - `DELETE o  ,   u FROM ...`
- Confirms deterministic behavior boundary:
  - repeated-space target-token SET currently rejects with `ERR_UNSUPPORTED_UPDATE`
  - repeated-space multi-target DELETE is rejected with `ERR_UNSUPPORTED_DELETE`
  - both paths keep constraint-cost counters unchanged.
- Included phaseA85 in grouped semantic runner.

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
