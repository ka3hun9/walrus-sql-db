# SQL Gap Matrix (Current vs Target)

## Current snapshot (v0.4.x evolving)

| Area | Status | Notes |
|---|---|---|
| SELECT/WHERE/ORDER/LIMIT/OFFSET | ✅ | Baseline stable + 3VL filter semantics + expression first-cut (`+ - * / %`, CASE, COALESCE, NULLIF, CAST) |
| Aggregates + GROUP BY/HAVING | ✅ | COUNT/SUM/AVG/MIN/MAX |
| JOIN | 🟡 | INNER/LEFT/RIGHT (first-cut) |
| Subquery | 🟡 | IN/EXISTS/scalar/ANY/ALL first-cut + correlated WHERE refs via `outer.<col>` + FROM subquery first-cut |
| UNION | 🟡 | UNION / UNION ALL first-cut |
| Window | 🟡 | ROW_NUMBER first-cut |
| NULL/LIKE | ✅ | 3VL, IS NULL/IS NOT NULL, LIKE/NOT LIKE, LIKE ESCAPE |
| Distinctness predicates | ✅ | IS DISTINCT FROM / IS NOT DISTINCT FROM |
| Boolean truth predicates | ✅ | IS [NOT] TRUE/FALSE/UNKNOWN |
| Transaction semantics | ❌ | Not implemented |
| Full SQL parser/AST | ❌ | Lightweight parser, not SQL-complete |
| Cost-based optimizer | ❌ | Not implemented |

## Next milestones

1. **Sprint E (in progress / phase-1 done)**
   - ✅ Matrix coverage expanded (PR profile + nightly profile)
   - ✅ SQLite dialect mapping extracted to dedicated module (`examples/sql-compare-dialect.ts`)
   - ✅ CI split by profile:
     - `.github/workflows/sql-compare.yml` (PR/push)
     - `.github/workflows/sql-compare-nightly.yml` (scheduled)
   - ✅ Report supports category summary and XFAIL/XPASS tracking

2. **M1 (stabilize)**
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
