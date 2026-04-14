# CTE and WITH Clause

## P4-CTE-001 / P4-CTE-002

### Basic Syntax
```sql
WITH cte_name AS (SELECT ...) SELECT * FROM cte_name;
```

### Multi-CTE
```sql
WITH
  t1 AS (SELECT id, name FROM users WHERE active = true),
  t2 AS (SELECT * FROM orders WHERE status = 'pending')
SELECT t1.name, t2.amount FROM t1 JOIN t2 ON t1.id = t2.user_id;
```

### CTE Scope Rules
- CTE names are visible to subsequent CTEs in the same WITH clause
- CTE shadows any同名 table in the outer query
- CTEs are ephemeral (not persisted to disk)

## Verification
- `test/unit-p4-cte-001-basic-with.ts` - basic WITH functionality
- `test/unit-p4-cte-002-binding-consistency.ts` - binding and scope rules
- `test/sqllogic/sql92-p4-cte-multi.slt` - SQL-92 conformance suite
