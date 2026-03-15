# Milestone Acceptance: Schema Change Path

## J-MILE-003
- Added `test/unit-j-mile-003-schema-change-acceptance.ts`.
- Acceptance flow validates:
  - `ALTER TABLE ADD COLUMN` (default + `NOT NULL`),
  - `ALTER TABLE DROP COLUMN`,
  - dependency-aware `DROP TABLE` rejection,
  - successful dependent-table drop then parent-table drop,
  - post-drop access failure (`ERR_TABLE_NOT_FOUND`).
