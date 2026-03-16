# FOREIGN KEY Parsing

## P2-FK-001
- `CREATE TABLE` parser supports both FK forms:
  - Column-level: `col TYPE REFERENCES parent_table(parent_col)`
  - Table-level: `FOREIGN KEY (col1, col2) REFERENCES parent_table(parent_col1, parent_col2)`
- Validation at parse stage:
  - FK child columns must exist in current table definition.
  - Child/ref column counts must match for table-level FK declarations.
- Coverage: `test/unit-e-ddl-005-foreign-key-parse-levels.ts`.
