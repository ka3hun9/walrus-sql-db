# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Current testnet package

- `PackageID`: `0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95`
- `Module`: `walrus_sql`

## Install

```bash
npm install
```

## RPC endpoints (for quick failover)

If one endpoint times out, switch `SUI_RPC_URL` immediately.

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443` ✅ (validated in this project)
- `https://testnet.suiet.app:443`

## 1) Simulator demo

```bash
npm run dev
```

## 2) SQL -> Move call plan

```bash
npm run onchain:plan
```

## 3) Real on-chain CRUD smoke test (Phase-3)

1. Create `.env`:

```powershell
copy .env.example .env
```

2. Fill `.env`:

```env
SUI_PRIVATE_KEY=suiprivkey1...
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_CATALOG_ID=<Catalog object id>
```

3. Run full CREATE/INSERT/UPDATE/DELETE on-chain test:

```bash
npm run onchain:exec
# or
npm run onchain:smoke
```

What Phase-3 does:
- uses existing `Catalog` for `create_table(catalog, name, schema)`
- captures created `TableMeta` object id
- maps table name -> object id in-process
- sends real insert/update/delete tx with object args
- checks tx success status

## 4) SELECT query layer (Phase-4)

### 4.0 Metadata read (TableMeta)

```bash
npm run onchain:select
```

Reads TableMeta object fields (`name/schema/commit_count/latest_*`).

### 4.1 Event replay row view (MVP)

```bash
npm run onchain:select-replay
```

This replays on-chain `CommitWritten` events for the target table and reconstructs row state by decoding JSON payload carried in transaction input strings.

Supported query subset:
- `SELECT * FROM <table>`
- `SELECT <fields> FROM <table> WHERE id = '...'`

### 4.2 Pagination + incremental cache

`select-replay` now supports:
- `LIMIT <n> OFFSET <m>`
- incremental event sync cache (per table object id) so repeated queries avoid full replay from genesis.

Example:
- `SELECT * FROM orders LIMIT 20 OFFSET 0`
- `SELECT id, status FROM orders WHERE id = 'ord_1' LIMIT 10 OFFSET 0`

### 4.3 SDK built-in replay module

Replay query logic is now reusable via:
- `src/query-replay.ts`
- `createReplayQueryExecutor(...)`

So downstream apps can do:
- `import { createReplayQueryExecutor } from "walrus-sql-db"`
- inject it into `WalrusSqlClient({ onchainQueryExecutor: ... })`

Set in `.env`:

```env
WALRUS_SQL_TABLE_NAME=orders
WALRUS_SQL_TABLE_ID=<TableMeta object id>
```

## Where to find IDs

### `WALRUS_SQL_CATALOG_ID`
Use `sui client objects --address <your address>` and find object type:

`<PACKAGE_ID>::walrus_sql::Catalog`

### `WALRUS_SQL_TABLE_ID`
Take it from CREATE output (`tableId: ...`) or find object type:

`<PACKAGE_ID>::walrus_sql::TableMeta`

## Publish again (if contract changed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "<your address>"
```
