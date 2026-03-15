# ALTER TABLE DROP COLUMN Dependency Validation

## E-DDL-003
- `ALTER TABLE ... DROP COLUMN` now rejects drops when the column is dependency-bound:
  - primary-key member -> `ERR_CONSTRAINT_VIOLATION:PK_DROP`
  - single-column unique -> `ERR_UNSUPPORTED_DDL` (`cannot DROP UNIQUE column`)
  - composite unique member -> `ERR_UNSUPPORTED_DDL` (`referenced by UNIQUE constraint`)
- Non-dependent columns can still be dropped, and row/index metadata stays consistent after the change.
