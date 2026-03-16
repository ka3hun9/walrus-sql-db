# FK Cycle And Cascade Depth Protection

## P2-FK-007
- DDL-time guard rejects FK cascade cycles in the schema dependency graph.
  - Applies to tables participating in `ON DELETE CASCADE` or `ON UPDATE CASCADE` edges.
- Runtime guard enforces max cascade traversal depth for delete cascades:
  - `MAX_FK_CASCADE_DEPTH = 16`
  - Exceeding this limit raises `ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY`.
- Purpose: avoid unbounded cascade propagation in cyclic/deep dependency setups.
- Coverage: `test/unit-f-fk-007-cycle-depth-protection.ts`.
