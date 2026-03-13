# G5 Notes

## G5-A: Dialect profile gating scaffold

Implemented:
- Added dialect profile type: `ansi | sqlite | postgres | mysql | sqlserver`
- `inspectSqlGrammarSkeleton(sql, { dialect })` now gates TOP/FETCH by dialect profile:
  - `TOP` precheck blocked for non-sqlserver
  - `FETCH FIRST/NEXT` precheck blocked for ansi/sqlite
- `parseSqlToAst` accepts options with dialect and routes precheck through dialect-aware grammar inspection.
- `WalrusSqlClient` now passes `opts.dialect ?? "ansi"` into AST parse path.

Regression:
- `examples/sql-g5-dialect-gating-regression.ts`
  - validates non-target dialects fail with `SQL_DIALECT_UNSUPPORTED_SYNTAX`
  - validates target dialect grammar-recognition staging via skeleton inspection

## G5-B: SQL Server TOP n (parser+executor)

Implemented:
- `SELECT TOP <n> ...` enabled under `dialect: "sqlserver"`
- parser strips TOP from select list and maps to AST `limit`
- malformed `TOP` (non-numeric) returns `SQL_SYNTAX_INCOMPLETE_STATEMENT`
- non-sqlserver dialects keep `SQL_DIALECT_UNSUPPORTED_SYNTAX`

Regression:
- `examples/sql-g5-sqlserver-top-regression.ts`

