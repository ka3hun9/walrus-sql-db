# ALTER TABLE ADD COLUMN Default/NOT NULL

## E-DDL-002
- `ALTER TABLE ... ADD COLUMN` now supports `DEFAULT <literal>` parsing.
- Non-empty table + `NOT NULL` column without a usable default is rejected with:
  - `ERR_CONSTRAINT_VIOLATION:NOT_NULL_ADD_COLUMN`
- Existing rows are backfilled during `ADD COLUMN`:
  - with coerced default when `DEFAULT` is provided
  - with `NULL` when no default is provided
- Missing-column writes (for INSERT/UPDATE candidate rows) now apply schema defaults before type/constraint checks.
