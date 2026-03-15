# DROP TABLE Semantics

## E-DDL-001
- `DROP TABLE <name>` now returns explicit errors for two key paths:
  - table does not exist: `ERR_TABLE_NOT_FOUND`
  - table has schema dependencies: `ERR_UNSUPPORTED_DDL` with dependent table/column context
- Dependency checks are driven by parsed `REFERENCES` metadata from `CREATE TABLE`.
- Successful drop still clears in-memory table/schema/index/cache metadata.
