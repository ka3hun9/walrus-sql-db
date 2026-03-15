# PRIMARY KEY Auto Index Maintenance

## F-CONST-001
- PRIMARY KEY columns (single or composite) are auto-indexed through the unique-index path.
- Maintenance behavior is consistent across DML:
  - `INSERT` checks PK conflicts against current index state.
  - `UPDATE` updates PK index entries in old->new order.
  - `DELETE` removes PK index entries before row removal.
- Covered by `test/unit-f-const-001-primary-key-index-maintenance.ts`.
