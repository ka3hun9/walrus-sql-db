# SQL Baseline v1 Freeze Declaration

Status: **FROZEN** (G2)
Date: 2026-03-13

## Frozen Surface

Accepted statement families:
- SELECT
- UNION / UNION ALL (first-cut)

Accepted clause order (baseline parser contract):
- WHERE -> GROUP BY -> HAVING -> ORDER BY -> LIMIT -> OFFSET

Accepted core features (first-cut):
- FROM table / FROM subquery
- basic JOIN (INNER/LEFT/RIGHT)
- expression core (arithmetic, CASE, COALESCE, NULLIF, CAST)
- predicate core (IN/BETWEEN/LIKE/IS NULL/3VL distinctness family)

## Explicitly Rejected in v1 (must error)
- CTE (`WITH ...`) -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- `TOP` -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- `FETCH FIRST|NEXT` -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- non-SELECT/UNION statements -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- invalid clause order -> `SQL_SYNTAX_INVALID_CLAUSE_ORDER`
- incomplete malformed SELECT/FROM -> `SQL_SYNTAX_INCOMPLETE_STATEMENT`

## Freeze Guardrails

Required checks before merge for parser-boundary changes:
1. `npx tsx examples/sql-parser-g1-gate.ts`
2. `npx tsx examples/sql-baseline-v1-matrix.ts`

Any change to frozen behavior requires:
- contract note in `docs/sql-spec-baseline-v1.md`
- matrix updates in `examples/sql-baseline-v1-matrix.ts`
- explicit compatibility note in commit message/docs

## Forward Policy

- v1 contracts remain stable.
- New grammar/features must be introduced as additive extensions and must not silently alter v1 accepted/rejected outcomes.
