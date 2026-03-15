# Pre-Release Compatibility Checklist

## I-ENG-004

## Backward Compatibility Statement
- Public entrypoints exposed by `src/index.ts` are treated as backward-compatible for patch/minor updates.
- Existing env-based config keys (`WALRUS_SQL_*`) remain supported.
- Existing error-code namespace contracts (`ERR_*`, `SQL_*`) remain stable and machine-parseable.

## Pre-Release Gate Checklist
- [ ] Build passes (`npm run build`)
- [ ] Unit/integration/regression gates pass (`npm run test:ci`)
- [ ] Benchmark gate passes (`npm run test:ci:benchmark`)
- [ ] Public API export compatibility check passes (`test/unit-i-eng-004-release-compatibility-checklist.ts`)
- [ ] Breaking-change notes are present if any public contract changed
