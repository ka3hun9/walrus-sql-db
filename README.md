# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Phase-2 delivered

- Sui Move contract scaffold at `contracts/walrus_sql`
  - `Catalog`
  - `TableMeta`
  - commit events for insert/update/delete
- SDK on-chain mode (`mode: "onchain"`)
  - SQL -> Move call planning
  - optional executor hook for real chain submission
- Deploy helper script: `scripts/deploy-testnet.ps1`

## Quick start

```bash
npm install
npm run build
npm run dev
```

## Simulator CRUD example

```bash
npm run dev
```

## On-chain planning example

```bash
npm run onchain:plan
```

This prints the Move call payloads that your wallet/executor should submit.

## Real testnet publish (your wallet)

1. Install Sui CLI
2. Ensure your wallet has test SUI (you already have it)
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-testnet.ps1
```

Then set `packageId` in SDK and execute with your own `onchainExecutor` integration.

## Planned next milestones

1. Wire SDK default executor with `@mysten/sui` signer
2. Parse publish output and auto-write `.env` package id
3. Add table object discovery + table-id aware Move calls
4. Walrus blob manifest serializer
5. Query proof verification spec (hash-chain + merkle root)
