# P2 Mile-007 Walrus Testnet Evidence Report

## Scope
- Goal: supplement Phase-2 with **real Walrus/Sui testnet execution evidence** (not simulator-only).
- Method: run on-chain CRUD flow and fetch each tx-block proof from chain RPC.

## Run Metadata
- executedAt: 2026-03-17T11:00:27+08:00
- network: testnet
- rpc: https://rpc-testnet.suiscan.xyz:443
- tableId: `0x7ebeae0271a73650e4213bf2a02e12ac29385c83a4d2fbb01d4836bd0e7701fb`
- result: **allSuccess = true**

## On-Chain Transaction Proofs
- CREATE: `3saXNX9toJ7vNGjqfQpme42zrnByytyVUcwYR3kEdocH` (success)
- INSERT: `7e7xJ7qi45Wr35T8AbyAn8AJn1KkfLzNfbN8GX2PaeBC` (success)
- UPDATE: `GCFXokPHepwJMjZ9meRrY1B2UXc3MSZ8BuytusKTLmYi` (success)
- DELETE: `2LCdNaQCbqPFJxZ9HjRi6nHMXnioNVtBkkwGdNcQKKGx` (success)

## Artifacts
- Evidence folder: `reports/p2-evidence/20260317-105926/`
- Raw run log: `reports/p2-evidence/20260317-105926/onchain-exec.log`
- Parsed summary: `reports/p2-evidence/20260317-105926/evidence-summary.json`
- Tx proofs:
  - `reports/p2-evidence/20260317-105926/tx-01-create.json`
  - `reports/p2-evidence/20260317-105926/tx-02-insert.json`
  - `reports/p2-evidence/20260317-105926/tx-03-update.json`
  - `reports/p2-evidence/20260317-105926/tx-04-delete.json`

## Automation Added
- New script: `scripts/p2-evidence-walrus-testnet.ps1`
- Purpose:
  1. build project
  2. run `npm run onchain:exec`
  3. parse tx digests/tableId
  4. fetch tx-block json proofs
  5. generate machine + human readable report

## Conclusion
Phase-2 now has **testnet chain evidence** linked to immutable tx digests, closing the “real network proof chain” gap on top of existing simulator + acceptance suites.
