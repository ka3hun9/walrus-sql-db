# SQL Type Representation Consistency

## A-TYPE-017
- Canonical runtime type names are defined once in `src/types.ts`.
- Parser/executor/storage paths normalize aliases to canonical names via `normalizeRuntimeTypeName(...)`:
  - `INTEGER -> INT`
  - `REAL -> DOUBLE`
  - `NUMERIC -> DECIMAL`
- Column schema types (`src/sql-catalog.ts`) now derive from runtime type names, so parser schema and runtime coercion cannot drift independently.
- CAST target normalization uses the same canonical resolver as DDL type parsing.
