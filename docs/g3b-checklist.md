# G3-B Completion Checklist

Status: in-progress closeout snapshot

## Delivered in G3-B

### Subquery edge semantics
- [x] Correlated EXISTS regression added
- [x] NOT IN + NULL propagation regression added
- [x] Scalar subquery null-compare regression added
- [x] Subquery projection fixed to support expression projection (`SELECT 1` style)

Reference:
- `examples/sql-g3b-subquery-edge-regression.ts`

### Expression edge semantics
- [x] AST predicate eval: `COALESCE`
- [x] AST predicate eval: `NULLIF`
- [x] AST predicate eval: `CAST`
- [x] CASE path retained and regression-covered via bounded raw fallback
- [x] Composed-expression regression (CAST+COALESCE+NULLIF + 3VL behavior)

Reference:
- `examples/sql-g3b-expr-edge-regression.ts`
- `examples/sql-g3b-cast-case-regression.ts`
- `examples/sql-g3b-composed-expr-regression.ts`

## Remaining before G3-B close
- [x] add differential fixture mapping for the above scenarios (`docs/g3b-differential-fixtures.md`)
- [x] wire regressions into grouped SQL semantic runner (`npm run sql:semantic:grouped`)
- [x] wire grouped runner into CI grouped SQL suite (`.github/workflows/sql-compare*.yml`)
- [x] publish mismatch budget note (`docs/g3b-mismatch-budget.md`)
