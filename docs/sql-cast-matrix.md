# SQL CAST / Implicit Conversion Matrix

## A-TYPE-016
- Conflict strategy:
  - `implicit` conversion rejects unsafe/ambiguous paths.
  - `explicit` `CAST(...)` may allow additional paths, but invalid payloads still raise `ERR_TYPE_CONSTRAINT`.

## Core rules
- `NULL -> any`: allowed.
- `same-type -> same-type`: allowed.
- `any -> TEXT/STRING/CHAR/VARCHAR`: allowed.
- `any -> BLOB`: allowed (canonical BLOB encoder handles normalization).
- `numeric <-> numeric`: allowed.
- `text -> numeric`: allowed (parse must succeed).
- `BOOLEAN -> numeric`:
  - implicit: rejected.
  - explicit: allowed.
- `text/numeric -> BOOLEAN`: allowed only for accepted boolean literals (`true/false/1/0`).
- `temporal targets (DATE/TIME/TIMESTAMP)`: text-based input only.
