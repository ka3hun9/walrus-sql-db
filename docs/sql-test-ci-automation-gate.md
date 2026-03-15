# CI Automation Gates

## H-TEST-007
- Added scoped CI runners:
  - `npm run test:ci:unit`
  - `npm run test:ci:integration`
  - `npm run test:ci:regression`
  - `npm run test:ci:benchmark`
- Updated aggregate CI commands:
  - `npm run test:ci` runs unit + integration + regression.
  - `npm run ci:full` runs `build` + `test:ci` + `test:ci:benchmark`.
- Updated GitHub Actions workflow `.github/workflows/ci-tests.yml` to execute the same gate order and keep benchmark report artifact upload.
