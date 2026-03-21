# walrus-sql-db (English)

Hub: [README.md](./README.md) | 中文: [README.zh-CN.md](./README.zh-CN.md)

Pure on-chain oriented Walrus SQL SDK starter.

## Features

- SQL capability: `WHERE(AND/OR/IN/comparators/LIKE/IS NULL)`, multi-order, group/having, aggregates, explain
- Simulator JOIN (`INNER/LEFT/RIGHT`) + UNION/UNION ALL + `ROW_NUMBER()` (first-cut)
- Subquery first-cut: `IN (SELECT col FROM table)`
- On-chain replay SELECT with persistent cache (`WALRUS_SQL_REPLAY_CACHE_FILE`)
- On-chain replay JOIN (replay left+right tables then local join)
- Auto table discovery by `TableCreated` events
- Gap tracking matrix: `docs/SQL_GAP_MATRIX.md`

## RPC failover (testnet)

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443`
- `https://testnet.suiet.app:443`

## Run

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
npm run onchain:join-replay
npm run onchain:benchmark-replay
npm run p2:bench:tpcc
npm run p2:bench:conflict
npm run p2:bench:longrun
npm run sql:logic
npm run sql:logic:p2
```

## P2 Operations Runbook

- Runbook: `docs/sql-p2-operations-runbook.md`
- Recommended P2 acceptance flow:

```bash
npm run build
npm run test:ci
npm run p2:bench:tpcc
npm run p2:bench:conflict
npm run p2:bench:longrun
npm run sql:logic
npm run sql:logic:p2
```

## CI / Verification

- PR workflow: category-parallel matrix checks + roadmap smoke
- Nightly workflow: extended matrix profile
- Full local verification:

```bash
npm run sql:verify:full
```

Matrix reports include per-category summary and support XFAIL/XPASS markers.

## Env

```env
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
SUI_OWNER_ADDRESS=0x...
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_TABLE_NAME=orders
WALRUS_SQL_TABLE_ID=
WALRUS_SQL_LEFT_TABLE=orders
WALRUS_SQL_RIGHT_TABLE=users
WALRUS_SQL_LEFT_TABLE_ID=
WALRUS_SQL_RIGHT_TABLE_ID=
WALRUS_SQL_REPLAY_CACHE_FILE=.cache/replay-cache.json
```
