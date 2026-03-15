# DML Constraint Check Order

## D-DML-007
- `UPDATE` row pipeline (per touched left row):
  1. Build candidate row and run type/constraint checks (`NOT NULL`, `UNIQUE`, etc.).
  2. On success, mutate indexes/data in fixed order: remove old unique keys -> write row -> add new unique keys.
  3. On failure, do not mutate row or indexes for that row.
- `DELETE` row pipeline:
  1. Evaluate predicates and mark matched rows.
  2. For matched rows, remove unique index entries before dropping rows from the table snapshot.
  3. Released unique keys are reusable by subsequent DML.
- The order is deterministic and repeatable, covered by `test/unit-d-dml-007-dml-constraint-order.ts`.
