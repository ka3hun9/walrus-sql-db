# ORDER/LIMIT Stability in Complex Queries

## C-EXEC-006
- Complex query paths (JOIN / GROUP BY / HAVING) preserve deterministic ordering when explicit multi-key `ORDER BY` is provided.
- `LIMIT/OFFSET` is applied after full ordering, ensuring stable page slices for repeated executions with identical data.
