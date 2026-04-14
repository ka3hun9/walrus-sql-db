# Dynamic SQL (PREPARE/EXECUTE)

## P4-DYN-001 through P4-DYN-004

### Syntax
```sql
-- Prepare a statement with parameter placeholders (?)
PREPARE stmt_name AS SELECT ... FROM ... WHERE id = $1;

-- Execute with parameter values
EXECUTE stmt_name(value1);

-- Execute with named parameters
EXECUTE stmt_name USING value1, value2;
```

### PREPARE Semantics
- Statement name is case-insensitive
- Parameters use `$1`, `$2`, etc. or `?` placeholders
- Prepared statements are session-scoped (lost on session end)
- Type constraints enforced at PREPARE time based on first execution

### EXECUTE Semantics
- Binds values to placeholders
- Type conversion attempted if mismatch
- NULL binding supported
- Returns same result set as the original statement

### Security
- PREPARE/EXECUTE does NOT prevent SQL injection if user input is concatenated into the statement string
- Always use parameter binding: `PREPARE p AS SELECT * FROM t WHERE id = $1` + `EXECUTE p(42)`

### Limitations
- DDL statements cannot be prepared
- Transaction boundaries affect prepared statement validity

## Verification
- `test/unit-p4-dyn-001-004-dynamic-sql.ts` - dynamic SQL test suite
