# Commit-Point Revalidation

## P2-EXE-002
- Transaction commit now performs a second constraint/index validation pass before apply:
  - builds snapshot = latest committed state overlaid with current transaction staged tables
  - revalidates `NOT NULL`, `UNIQUE/PK`, and FK integrity on staged tables
- This catches late conflicts introduced by concurrent commits between statement execution and `COMMIT`.
- Revalidation runs after write-conflict version checks and before WAL commit apply.
- Coverage: `test/unit-p2-exe-002-commit-revalidation.ts`.
