# Error Context: Token/Clause/Field

## F-CONST-006
- Parser/semantic `SqlEngineError` payloads expose `details.token` for pinpointing SQL surface context.
- Client/constraint errors now append structured context markers in message text:
  - `token=<...>`
  - `clause=<...>`
  - `field=<...>`
- This makes failures both human-readable and machine-parseable for diagnostics.
- Covered by `test/unit-f-const-006-error-context.ts`.
