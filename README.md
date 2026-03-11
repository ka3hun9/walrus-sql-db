# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Current testnet package

- `PackageID`: `0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95`
- `Module`: `walrus_sql`

## Install

```bash
npm install
```

## 1) Simulator demo

```bash
npm run dev
```

## 2) SQL -> Move call plan

```bash
npm run onchain:plan
```

## 3) Real on-chain CRUD smoke test

1. Create `.env`:

```powershell
copy .env.example .env
```

2. Fill `.env`:

```env
SUI_PRIVATE_KEY=suiprivkey1...
SUI_NETWORK=testnet
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
```

3. Run full CREATE/INSERT/UPDATE/DELETE on-chain test:

```bash
npm run onchain:exec
# or
npm run onchain:smoke
```

What phase-3 now does:
- auto-inits `Catalog` (if missing)
- captures created `TableMeta` object id from transaction result
- maps table name -> object id in-process
- sends real insert/update/delete tx with object args
- checks tx success status (not just digest)

## Publish again (if contract changed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "<your address>"
```
