# FK Catalog Metadata

## P2-FK-002
- `TableSchema.foreignKeys` stores:
  - child columns (`columns`)
  - referenced table/columns (`refTable`, `refColumns`)
  - match rule (`matchRule`: `SIMPLE|FULL|PARTIAL`)
  - referential actions (`onDelete`, `onUpdate`)
- Parsing supports table-level and column-level FK declarations with optional:
  - `MATCH ...`
  - `ON DELETE ...`
  - `ON UPDATE ...`
- Defaults when action clauses are omitted:
  - `matchRule = SIMPLE`
  - `onDelete = NO ACTION`
  - `onUpdate = NO ACTION`
- Coverage: `test/unit-f-fk-002-catalog-metadata.ts`.
