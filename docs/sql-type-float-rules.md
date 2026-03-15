# SQL FLOAT/DOUBLE Runtime Rules

## A-TYPE-006: FLOAT
- Parsing/coercion: `FLOAT` accepts numeric literals that JavaScript `Number(...)` can parse (including scientific notation like `1e2`).
- Finite-only policy: `NaN`, `Infinity`, and `-Infinity` are rejected with `ERR_TYPE_CONSTRAINT`.
- Precision model: runtime values use IEEE-754 double-precision (`number` in JavaScript), so binary floating precision artifacts are expected.
- Equality and comparison:
  - `=` / `!=` use exact runtime value equality (no epsilon tolerance).
  - `<`, `<=`, `>`, `>=` use numeric ordering when both sides are finite numbers.
