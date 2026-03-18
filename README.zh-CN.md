# walrus-sql-db（中文）

总览：[README.md](./README.md) | English: [README.en.md](./README.en.md)

面向链上回放查询的 Walrus SQL SDK。

## 功能

- SQL 能力：`WHERE(AND/OR/IN/比较符/LIKE/IS NULL)`、多字段排序、GROUP BY/HAVING、聚合、EXPLAIN
- Simulator JOIN（`INNER/LEFT/RIGHT`）+ UNION/UNION ALL + `ROW_NUMBER()`（首版）
- 子查询首版：`IN (SELECT col FROM table)`
- On-chain replay 查询 + 持久化缓存（`WALRUS_SQL_REPLAY_CACHE_FILE`）
- On-chain replay JOIN（两表回放 + 本地 join）
- 基于 `TableCreated` 事件的自动发现表
- 差距跟踪矩阵：`docs/SQL_GAP_MATRIX.md`

## Testnet RPC（故障切换）

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443`
- `https://testnet.suiet.app:443`

## 运行

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

## P2 运维手册

- 运维手册：`docs/sql-p2-operations-runbook.md`
- 建议的 P2 验收流程：

```bash
npm run build
npm run test:ci
npm run p2:bench:tpcc
npm run p2:bench:conflict
npm run p2:bench:longrun
npm run sql:logic
npm run sql:logic:p2
```

## CI / 验证

- PR 工作流：按 category 并行矩阵校验 + roadmap smoke
- Nightly 工作流：扩展矩阵 profile
- 本地全量验收：

```bash
npm run sql:verify:full
```

矩阵报告包含按类别汇总，并支持 XFAIL/XPASS 标记。

## 环境变量

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
