# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Current testnet package

- `PackageID`: `0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95`
- `Module`: `walrus_sql`

## Install

```bash
npm install
```

## RPC endpoints (quick failover)

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443` ✅ validated
- `https://testnet.suiet.app:443`

## Phase status

- Phase-3 ✅ real on-chain CRUD
- Phase-4.0~4.6 ✅ query layer complete
- Phase-5 ✅ persistent replay cache + benchmark
- Phase-6 ✅ payload v2 + commit-hash chain verification
- Phase-7 ✅ engineering scripts + test/benchmark entrypoints
- Phase-8 ✅ delivery docs and reusable SDK interfaces

---

## Core scripts

```bash
npm run dev
npm run onchain:plan
npm run onchain:exec
npm run onchain:select
npm run onchain:select-replay
npm run onchain:benchmark-replay
```

---

## Env template

```env
SUI_PRIVATE_KEY=suiprivkey1...
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
SUI_OWNER_ADDRESS=0x...
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_CATALOG_ID=<Catalog object id>
WALRUS_SQL_TABLE_NAME=orders_1773231191643
WALRUS_SQL_TABLE_ID=
WALRUS_SQL_REPLAY_CACHE_FILE=.cache/replay-cache.json
```

`WALRUS_SQL_TABLE_ID` is optional when auto-discovery is enabled (`SUI_OWNER_ADDRESS` + table name).

---

## Query capability (replay executor)

Supported:
- `SELECT * FROM table`
- `SELECT f1,f2 FROM table WHERE a='x' AND b='y'`
- `ORDER BY field ASC|DESC`
- `LIMIT/OFFSET`
- `SELECT COUNT(*) ...`

Replay executor features:
- incremental event replay (`cursor + seenDigests + rows`)
- persistent cache to file (`WALRUS_SQL_REPLAY_CACHE_FILE`)
- auto-discover table object id by owner+table name
- payload v2 chain verification (`previousCommitHash/currentCommitHash`)

---

## Benchmark (Phase-5)

```bash
npm run onchain:benchmark-replay
```

Outputs cold vs warm timings to validate cache effectiveness.

---

## SDK usage (Phase-8 delivery)

```ts
import { SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, createReplayQueryExecutor } from "walrus-sql-db";

const client = new SuiClient({ url: process.env.SUI_RPC_URL! });

const onchainQueryExecutor = createReplayQueryExecutor({
  client,
  packageId: process.env.WALRUS_SQL_PACKAGE_ID!,
  ownerAddress: process.env.SUI_OWNER_ADDRESS,
  autoDiscoverTables: true,
  cacheFilePath: process.env.WALRUS_SQL_REPLAY_CACHE_FILE,
});

const db = new WalrusSqlClient({
  packageId: process.env.WALRUS_SQL_PACKAGE_ID!,
  network: "sui-testnet",
  mode: "onchain",
  onchainQueryExecutor,
});
```

---

## Publish again (if contract changed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "<your address>"
```
