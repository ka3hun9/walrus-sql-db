# walrus-sql-db

Language / 语言：**[English](./README.en.md)** | **[中文](./README.zh-CN.md)**

Pure on-chain oriented Walrus SQL SDK starter.

## Quick Start

```bash
npm install
npm run build
npm run sql:advanced
npm run sql:join
npm run sql:roadmap
npm run sql:compare
npm run sql:compare:sqlite
npm run sql:compare:matrix
npm run sql:compare:matrix:category -- compare
npm run sql:compare:matrix:nightly
npm run sql:verify:full
npm run onchain:select-replay
```

## CI

GitHub Actions workflows:
- `.github/workflows/sql-compare.yml` (PR/push profile)
- `.github/workflows/sql-compare-nightly.yml` (nightly extended profile)

PR/push workflow runs:
- Category-parallel matrix jobs via `npm run sql:compare:matrix:category -- <category>`
- `npm run sql:roadmap`

Nightly workflow runs:
- `npm run build`
- `npm run sql:compare:matrix:nightly`

Artifacts:
- `reports/sql-compare-report.json` or `reports/sql-compare-nightly.json`
- `reports/mre/**` (when failures occur)

Note:
- Nightly profile can contain explicit `XFAIL` cases for known semantic gaps.
- Matrix runner prints per-category summary to console and JSON report.

## Key Scripts

```bash
npm run onchain:join-replay
npm run onchain:benchmark-replay
```

## Current Scope

- Advanced SQL parser/executor in simulator
- On-chain replay query executor with persistent cache
- On-chain replay JOIN (two-table replay + local join)
- SQL gap matrix: `docs/SQL_GAP_MATRIX.md`
- Bilingual docs (EN / 中文)
