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

## 4) Query layer roadmap completion

### 4.0 Metadata read (TableMeta)

```bash
npm run onchain:select
```

Reads TableMeta object fields (`name/schema/commit_count/latest_*`).

### 4.1 Event replay row view (MVP)

```bash
npm run onchain:select-replay
```

Replays `CommitWritten` events and reconstructs row state from structured payloads.

### 4.2 Pagination + incremental cache

Supported in replay executor:
- `LIMIT <n> OFFSET <m>`
- incremental cache (`cursor + seenDigests + rows`) per table object id

### 4.3 SDK built-in replay module

Reusable API:
- `src/query-replay.ts`
- `createReplayQueryExecutor(...)`

### 4.4 Multi-table auto discovery

If `WALRUS_SQL_TABLE_ID` is omitted, replay executor can auto-discover by scanning owner `TableMeta` objects.

Required for auto-discovery:

```env
SUI_OWNER_ADDRESS=0x...
WALRUS_SQL_TABLE_NAME=<table name>
```

### 4.5 Query capability upgrades

Replay path now supports:
- `WHERE a='x' AND b='y'`
- `ORDER BY <field> ASC|DESC`
- `SELECT COUNT(*) ...`

### 4.6 Delivery/stability baseline

- replay logic moved to SDK module (not example-only)
- configurable page size (`pageSize`)
- example wired to auto-discovery + advanced query cases

## Example Phase-4.4~4.6 env

```env
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
SUI_OWNER_ADDRESS=0x2dcb94eb47ef5345f8a5dc1607215b92c20bc12c4968278b6e3ab783905df9d5
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_TABLE_NAME=orders_1773231191643
# WALRUS_SQL_TABLE_ID optional when auto-discovery is enabled
```

Run:

```bash
npm run onchain:select-replay
```

## Publish again (if contract changed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "<your address>"
```
