# Logging Levels And Key Paths

## I-ENG-001
- Added `test/unit-i-eng-001-logging-key-paths.ts`.
- Coverage:
  - configurable log-level behavior (`debug`, `warn`),
  - key execute/query path logs:
    - `execute start`, `execute success`, `execute failed`
    - `query start`, `query success`, `query failed`
  - retry-path warning log (`walrus retry`) under injected transient onchain failures.
