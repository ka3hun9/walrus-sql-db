# Error Layering Stability

## F-CONST-005
- Error layers are now verified as stable and distinct:
  - parser syntax errors -> `SQL_SYNTAX_*` (`SqlEngineError`, family `SQL_SYNTAX`)
  - semantic binding/type errors -> `SQL_SEMANTIC_*` (`SqlEngineError`, family `SQL_SEMANTIC`)
  - dialect unsupported paths -> `SQL_DIALECT_*` (`SqlEngineError`, family `SQL_DIALECT`)
  - runtime/client execution failures -> `ERR_*` client codes (for example `ERR_TABLE_NOT_FOUND`, `ERR_EXECUTION_FAILED`)
- Covered by `test/unit-f-const-005-error-layering-stability.ts`.
