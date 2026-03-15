# Constraint Error Code Unification

## F-CONST-004
- Constraint failures use a machine-parseable envelope:
  - `ERR_CONSTRAINT_VIOLATION:<KIND>: <detail>`
- Covered kinds now include:
  - `NOT_NULL`
  - `DUPLICATE_KEY`
  - `PK_DROP`
  - `UNIQUE_DROP`
  - `DDL_DEPENDENCY`
  - `NOT_NULL_ADD_COLUMN`
- Covered by `test/unit-f-const-004-constraint-error-codes.ts`.
