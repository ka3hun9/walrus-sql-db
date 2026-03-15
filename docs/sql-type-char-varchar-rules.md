# SQL CHAR/VARCHAR Runtime Rules

## A-TYPE-008: CHAR(n)
- Fixed-length storage: `CHAR(n)` values are right-padded with spaces to exactly `n` characters.
- Overflow policy: input longer than `n` is rejected (`ERR_TYPE_CONSTRAINT`), not truncated.
- Consistency rule: insert and update both use the same pad/reject behavior.
