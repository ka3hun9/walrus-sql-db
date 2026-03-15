# Group/Having Aggregate Execution

## C-EXEC-005
- Combined grouped execution supports:
  - multi-key `GROUP BY`
  - aggregate projection (`SUM/COUNT/AVG/...`)
  - `HAVING` filters over aggregate outputs and grouped keys
- Execution order is validated as:
  - base filtering -> grouping/aggregation -> HAVING -> ORDER/LIMIT.
