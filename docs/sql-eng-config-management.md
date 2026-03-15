# Configuration Management

## I-ENG-002
- Added strict runtime validation in `src/config.ts` for:
  - `mode` (`simulator|onchain`)
  - `dialect` (`ansi|sqlite|postgres|mysql|sqlserver`)
  - `log level` (`debug|info|warn|error|silent`)
- Defaults + env + override precedence remain supported.
- Added gate test:
  - `test/unit-i-eng-002-config-management.ts`
  - verifies defaults, env overrides, override precedence, and invalid-value rejection.
