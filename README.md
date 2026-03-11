# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Current package (testnet)

- `PackageID`: `0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95`
- `Module`: `walrus_sql`

## Install

```bash
npm install
```

## Local simulator demo

```bash
npm run dev
```

## On-chain planning demo

```bash
npm run onchain:plan
```

## Real on-chain execute demo (CREATE TABLE)

1) Create `.env` from template:

```powershell
copy .env.example .env
```

2) Fill `SUI_PRIVATE_KEY` in `.env`.

3) Run:

```bash
npm run onchain:exec
```

> Note: `INSERT/UPDATE/DELETE` will be fully wired in next phase after table object ID discovery is added.

## Publish to testnet

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "<your address>"
```
