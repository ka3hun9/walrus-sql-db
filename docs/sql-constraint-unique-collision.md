# UNIQUE Constraint Collision Detection

## F-CONST-002
- UNIQUE collision checks are enforced for:
  - single-column unique constraints
  - composite unique constraints
- Collision checks apply on both `INSERT` and `UPDATE`.
- `NULL` values remain non-colliding under current UNIQUE semantics.
- Covered by `test/unit-f-const-002-unique-collision-detection.ts`.
