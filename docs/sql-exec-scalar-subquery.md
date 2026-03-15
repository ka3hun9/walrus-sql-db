# Scalar Subquery Execution Rules

## C-EXEC-003
- Scalar subquery comparison (`expr <op> (SELECT ...)`) enforces cardinality:
  - row count must be `0` or `1`
  - projected column count must be exactly `1`
- Behavior:
  - `0` rows => scalar value is `NULL`
  - `>1` rows => `ERR_UNSUPPORTED_SUBQUERY` (scalar cardinality violation)
  - `>1` columns => `ERR_UNSUPPORTED_SUBQUERY` (scalar projection violation)
