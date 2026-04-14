# GRANT / REVOKE Permission Model

## P4-SEC-001 through P4-SEC-005

### Syntax
```sql
-- Grant privileges
GRANT SELECT, INSERT ON table_name TO user_name;
GRANT ALL PRIVILEGES ON table_name TO user_name;
GRANT SELECT ON table_name TO PUBLIC;  -- grant to all users

-- Revoke privileges
REVOKE SELECT ON table_name FROM user_name;
REVOKE ALL PRIVILEGES ON table_name FROM user_name;
```

### Permission Model
- **Owner**: Table creator has all privileges on their tables
- **GRANT/REVOKE**: Owner can grant/revoke specific privileges to other users
- **PUBLIC**: Special pseudo-user representing all users
- **Permission catalog**: In-memory map tracking user→table→privilege grants

### Supported Privileges
- `SELECT` - read access
- `INSERT` - insert rows
- `UPDATE` - update rows
- `DELETE` - delete rows
- `REFERENCES` - foreign key references
- `ALL PRIVILEGES` - all above

### Permission Check Flow
1. Owner bypasses all checks
2. Internal tables (prefixed `__`) bypass checks
3. CTE tables (ephemeral) bypass checks
4. Check `SHARED_PERMISSION_CATALOG` for explicit grant
5. If no explicit grant, deny with `SQL_PERMISSION_DENIED`

### Error Codes
- `SQL_PERMISSION_DENIED` - user lacks required privilege
- `ERR_TABLE_NOT_FOUND` - table does not exist (checked before permission)

### Limitations
- No role-based access control (RBAC) - direct user grants only
- No schema-level grants
- No column-level grants

## Verification
- `test/unit-p4-sec-001-005-grant-revoke.ts` - permission model tests
