# information_schema System Views

## P4-INFO-001 through P4-INFO-005

### Available Views

#### information_schema.tables
Returns metadata about all tables accessible to the current user.

```sql
SELECT table_name, table_type, table_schema
FROM information_schema.tables
ORDER BY table_schema, table_name;
```

Columns:
- `table_name` - Name of the table
- `table_type` - 'BASE TABLE' or 'VIEW'
- `table_schema` - Schema name (default: 'main')

#### information_schema.columns
Returns metadata about all columns.

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'my_table'
ORDER BY ordinal_position;
```

Columns:
- `table_name` - Parent table name
- `column_name` - Column name
- `data_type` - SQL data type (INT, TEXT, REAL, etc.)
- `is_nullable` - 'YES' or 'NO'
- `column_default` - Default value expression
- `ordinal_position` - Position in table (1-based)

#### information_schema.table_constraints
Returns constraint metadata.

```sql
SELECT constraint_name, table_name, constraint_type
FROM information_schema.table_constraints
ORDER BY table_name;
```

Columns:
- `constraint_name` - Name of the constraint
- `table_name` - Parent table name
- `constraint_type` - 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK'

### Real-time Consistency
- DDL changes (CREATE/ALTER/DROP) are immediately reflected
- No caching or stale metadata

## Verification
- `test/unit-p4-info-001-005-information-schema.ts` - information_schema tests
- `test/benchmark/p4-bench-004-information-schema-stability.ts` - performance benchmark
