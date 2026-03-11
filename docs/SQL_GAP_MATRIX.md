# SQL Gap Matrix (Current vs Target)

## Current snapshot (v0.3.x evolving)

| Area | Status | Notes |
|---|---|---|
| SELECT/WHERE/ORDER/LIMIT/OFFSET | ✅ | Baseline stable |
| Aggregates + GROUP BY/HAVING | ✅ | COUNT/SUM/AVG/MIN/MAX |
| JOIN | 🟡 | INNER/LEFT/RIGHT (first-cut) |
| Subquery | 🟡 | `IN (SELECT col FROM table)` first-cut |
| UNION | 🟡 | UNION / UNION ALL first-cut |
| Window | 🟡 | ROW_NUMBER first-cut |
| NULL/LIKE | ✅ | IS NULL / IS NOT NULL / LIKE |
| Transaction semantics | ❌ | Not implemented |
| Full SQL parser/AST | ❌ | Lightweight parser, not standard SQL-complete |
| Cost-based optimizer | ❌ | Not implemented |

## Next milestones

1. **M1 (stabilize)**
   - Join correctness test matrix
   - Complex where precedence + parentheses AST
   - Subquery edge cases

2. **M2 (coverage)**
   - EXISTS / NOT EXISTS
   - FROM subquery
   - Extra windows (RANK, DENSE_RANK)

3. **M3 (engine)**
   - Transaction model (simulator)
   - Index/plan optimization
   - Rich EXPLAIN plan tree
