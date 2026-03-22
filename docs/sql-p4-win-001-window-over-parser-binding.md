# Window OVER Parser Binding

## P4-WIN-001
- Added parser-level window-definition support for:
  - `OVER (PARTITION BY ... ORDER BY ...)`
  - `OVER (ORDER BY ...)`
- `SELECT` items now bind parsed window metadata on `select_item.window`, including:
  - function name and args
  - `partitionBy` expression list
  - `orderBy` expression list with direction
- Malformed `OVER` clauses now fail with `SQL_SYNTAX_INCOMPLETE_STATEMENT` instead of being accepted as opaque raw text.
- Row-number planning now binds to parsed window metadata in AST (instead of regex-only raw parsing).

## Verification
- `test/unit-p4-win-001-window-over-parser-binding.ts`
  - validates AST window binding shape
  - validates malformed syntax rejection
  - validates runtime `ROW_NUMBER() OVER (...)` execution path remains correct
