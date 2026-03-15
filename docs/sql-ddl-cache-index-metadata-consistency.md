# DDL Schema/Index/Metadata Consistency

## E-DDL-004
- DDL paths now keep schema/index/cache metadata synchronized:
  - `CREATE TABLE` rejects duplicate names (prevents schema/index drift on overwrite).
  - `CREATE/DROP/ALTER` all invalidate read cache via the DDL write path.
  - `ALTER TABLE` rebuilds index metadata after schema shape changes.
  - `DROP TABLE` + recreate of the same name starts from clean schema/index state.
- Covered by `test/unit-e-ddl-004-ddl-metadata-consistency.ts`.
