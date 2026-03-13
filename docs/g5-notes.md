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

## G5-C: FETCH FIRST/NEXT row limiter

Implemented:
- parser tail now accepts `FETCH FIRST|NEXT <n> ROW|ROWS ONLY`
- enabled dialect profiles: `postgres`, `mysql`, `sqlserver`
- blocked dialect profiles: `ansi`, `sqlite` -> `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- malformed FETCH shape returns deterministic `SQL_SYNTAX_INCOMPLETE_STATEMENT`
- mixed row-limiter conflict (`TOP/LIMIT/FETCH` simultaneously) returns `SQL_SYNTAX_INVALID_CLAUSE_ORDER`

## G5-D: Dialect identifier quoting gateway

Implemented:
- parser pre-normalization now handles dialect-specific identifier quoting:
  - mysql: backticks (e.g. `` `users` ``)
  - sqlserver: bracket quoting (e.g. `[users]`)
- non-target dialect usage throws deterministic `SQL_DIALECT_UNSUPPORTED_SYNTAX`
- normalized quoted identifiers feed existing parser/executor path (no silent fallback)

## G5-E: Dialect function gating (explicit)

Implemented:
- parser adds dialect-specific function gate with deterministic error:
  - mysql-only: `IFNULL`
  - sqlserver-only: `ISNULL`, `IIF`
  - postgres-only: `DATE_TRUNC`
  - sqlite-only: `PRINTF`
- non-target dialect invocation fails fast with `SQL_DIALECT_UNSUPPORTED_FUNCTION`

## G5-F: Dialect operator gating (explicit)

Implemented:
- parser adds dialect-specific operator gate with deterministic error:
  - postgres-only: `ILIKE`, regex operators (`~`, `~*`, `!~`, `!~*`)
  - mysql/sqlite-only: `REGEXP`
- non-target dialect operator use fails fast with `SQL_DIALECT_UNSUPPORTED_OPERATOR`

## G5-G: CAST target type dialect gating

Implemented:
- parser adds CAST target-type gating to reject cross-dialect type leaks:
  - mysql-only: `UNSIGNED`, `SIGNED`
  - sqlserver-only: `NVARCHAR`, `DATETIME2`
  - postgres-only: `BYTEA`
  - sqlite-only: `NONE`
- non-target dialect CAST targets fail fast with deterministic `SQL_DIALECT_UNSUPPORTED_SYNTAX`

Regression:
- `examples/sql-g5-cast-type-gating-regression.ts`

