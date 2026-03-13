# SQL Baseline v1 — Accept/Reject Matrix

Status: G2 freeze preparation artifact

## Pass (accepted by baseline parser)
- SELECT with FROM/WHERE/GROUP/HAVING/ORDER/LIMIT/OFFSET in valid order
- UNION / UNION ALL (first-cut)

## Fail (must reject with explicit code)
- `WITH ...` (CTE staged) -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- `SELECT TOP ...` (dialect staged) -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- `... FETCH FIRST/NEXT ...` (dialect staged) -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- non-SELECT/UNION statements (e.g., DELETE) -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- invalid clause ordering (e.g., LIMIT before WHERE) -> `SQL_SYNTAX_INVALID_CLAUSE_ORDER`
- malformed/incomplete SELECT-FROM structure -> `SQL_SYNTAX_INCOMPLETE_STATEMENT`

## Validation command
```bash
npx tsx examples/sql-baseline-v1-matrix.ts
```

This matrix is the freeze guardrail to be expanded in G2 formal baseline lock.
