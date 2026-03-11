# walrus-sql-db

Pure on-chain oriented **Walrus SQL SDK starter**.

## Phase-2 delivered

- Sui Move contract scaffold at `contracts/walrus_sql`
- SDK on-chain mode (`mode: "onchain"`)
- SQL -> Move call planning
- Windows scripts for installing and publishing with Sui CLI

## Install dependencies

```bash
npm install
```

## Local simulator demo

```bash
npm run dev
```

## On-chain call planning demo

```bash
npm run onchain:plan
```

## Install Sui CLI (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-sui-cli.ps1
```

## Publish to Sui testnet

```powershell
# optional: pass your address
powershell -ExecutionPolicy Bypass -File scripts/publish-testnet.ps1 -Address "0x2dcb94eb47ef5345f8a5dc1607215b92c20bc12c4968278b6e3ab783905df9d5"
```

Publish output is saved to `publish-output.txt`.
Send it to me and I’ll wire the package ID into SDK config and generate real transaction executor code.
