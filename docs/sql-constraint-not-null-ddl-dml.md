# NOT NULL Across DDL/DML Paths

## F-CONST-003
- NOT NULL checks are enforced consistently in:
  - `CREATE TABLE` declared columns
  - `ALTER TABLE ADD COLUMN` (empty table + non-empty conflict paths)
  - `INSERT` and `UPDATE` writes
- Missing values on NOT NULL columns fail in DML unless a valid default is configured.
- Covered by `test/unit-f-const-003-not-null-ddl-dml.ts`.
