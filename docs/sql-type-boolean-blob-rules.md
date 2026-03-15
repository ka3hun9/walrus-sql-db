# SQL BOOLEAN/BLOB Runtime Rules

## A-TYPE-013: BOOLEAN
- Accepted BOOLEAN inputs: `true`, `false`, `1`, `0` (case-insensitive, surrounding whitespace ignored for string inputs).
- Coercion result is runtime boolean (`true`/`false`).
- Any other literal (for example `yes`, `2`) is rejected with `ERR_TYPE_CONSTRAINT`.

## A-TYPE-014: BLOB
- Canonical storage format: `base64:<payload>`.
- Accepted BLOB inputs:
  - raw text (encoded as UTF-8 then base64),
  - `base64:<payload>` (validated and canonicalized),
  - `hex:<payload>` (decoded then normalized to base64 form).
- Decode helper returns bytes from canonical base64 form.
- Invalid base64/hex payloads are rejected with `ERR_TYPE_CONSTRAINT`.
