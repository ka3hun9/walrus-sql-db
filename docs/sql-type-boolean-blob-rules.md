# SQL BOOLEAN/BLOB Runtime Rules

## A-TYPE-013: BOOLEAN
- Accepted BOOLEAN inputs: `true`, `false`, `1`, `0` (case-insensitive, surrounding whitespace ignored for string inputs).
- Coercion result is runtime boolean (`true`/`false`).
- Any other literal (for example `yes`, `2`) is rejected with `ERR_TYPE_CONSTRAINT`.
