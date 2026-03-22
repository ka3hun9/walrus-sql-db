# Pre-Release Compatibility Checklist

## I-ENG-004

## Backward Compatibility Statement
- Public entrypoints exposed by `src/index.ts` are treated as backward-compatible for patch/minor updates.
- Benchmark runners/report writers are treated as internal tooling under `test/benchmark/*` and are not part of the stable public API contract.
- Existing env-based config keys (`WALRUS_SQL_*`) remain supported.
- Existing error-code namespace contracts (`ERR_*`, `SQL_*`) remain stable and machine-parseable.

## Pre-Release Gate Checklist
- [ ] Build passes (`npm run build`, must clean `dist/` before compile)
- [ ] Unit/integration/regression gates pass (`npm run test:ci`)
- [ ] Benchmark gate passes (`npm run test:ci:benchmark`)
- [ ] Public API export compatibility check passes (`test/unit-i-eng-004-release-compatibility-checklist.ts`)
  - Scope: only stable core exports from `src/index.ts`; excludes benchmark helpers under `test/benchmark/*`
- [ ] Breaking-change notes are present if any public contract changed
