# Recursive CTE (WITH RECURSIVE)

## P4-RCTE-001 through P4-RCTE-005

### Syntax
```sql
WITH RECURSIVE cte_name AS (
  -- Anchor: initial rows
  SELECT ... FROM base_table
  UNION ALL
  -- Recursive: rows derived from cte_name
  SELECT ... FROM cte_name WHERE ...
)
SELECT * FROM cte_name;
```

### Execution Semantics
1. **Anchor** (base case): Execute the anchor query first, produce initial rows
2. **Recursive** (inductive case): Join cte_name with itself, producing new rows
3. **Termination**: When recursive query returns no new rows, or max depth (1000) is reached

### Features
- Depth limit protection: Maximum 1000 iterations to prevent infinite loops
- Row counter: Each iteration increments `__depth` internal counter
- Observability: Iteration count and row counts reported in execution metadata

### Example: Sequence Generation
```sql
-- Generate numbers 1-10
CREATE TABLE seed(val INT);
INSERT INTO seed VALUES (1);

WITH RECURSIVE seq AS (
  SELECT val FROM seed
  UNION ALL
  SELECT seq.val + 1 FROM seq WHERE seq.val < 10
)
SELECT val FROM seq;
```

### Example: Tree Traversal
```sql
-- Traverse org hierarchy
WITH RECURSIVE tree AS (
  SELECT id, name, manager_id, 0 as level FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, e.manager_id, tree.level + 1
  FROM employees e JOIN tree ON e.manager_id = tree.id
)
SELECT * FROM tree;
```

## Verification
- `test/unit-p4-rcte-001-005-recursive-cte.ts` - full recursive CTE test suite
- `test/sqllogic/sql92-p4-rcte-sequence.slt` - SQL-92 conformance suite
