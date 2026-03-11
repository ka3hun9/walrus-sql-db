# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## What is included

- TypeScript SDK skeleton (`WalrusSqlClient`)
- SQL subset methods: `CREATE / INSERT / SELECT / UPDATE / DELETE`
- `queryWithProof()` + `verify()` API shape
- Runnable CRUD example

> Current implementation is an in-memory MVP simulator for fast iteration.
> Next step is wiring each method to real Sui Move entry functions + Walrus manifests.

## Quick start

```bash
npm install
npm run dev
```

## SDK usage

```ts
import { WalrusSqlClient } from "walrus-sql-db";

const db = new WalrusSqlClient({
  packageId: "0xYOUR_MOVE_PACKAGE",
  network: "sui-mainnet",
  signerAddress: "0xYOUR_SIGNER",
});

await db.execute(`CREATE TABLE users (id STRING PRIMARY KEY, name STRING)`);
await db.execute(`INSERT INTO users (id, name) VALUES ('u1', 'MT')`);
const row = await db.queryOne(`SELECT id, name FROM users WHERE id = 'u1'`);
```

## Planned next milestones

1. Move package scaffold (`catalog`, `table_meta`, `commit_log`, `index_root`)
2. Transaction builders in SDK
3. Walrus blob manifest serialization
4. Proof verification spec (hash chain + merkle root)
5. Gas budget estimator
