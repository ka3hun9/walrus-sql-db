# P2 Mile-008 Txn Conflict & Recovery Evidence Report

## Scope
- Goal: extend Phase-2 evidence from on-chain CRUD (MILE-007) to transaction conflict + recovery acceptance and benchmark evidence.
- Focus:
  - ACID/rollback/read-committed/recovery acceptance subset
  - TPC-C-like conflict baseline
  - TPC-C-like soak consistency

## Run Metadata
- generatedAt: 2026-03-17T11:14:43+08:00
- network: testnet
- overall: **PASS**

## Acceptance Subset (all passed)
- `test/unit-c-exec-010-transaction-atomic-commit.ts`
- `test/unit-c-exec-011-transaction-rollback-consistency.ts`
- `test/unit-c-exec-013-read-committed-view.ts`
- `test/unit-p2-exe-002-commit-revalidation.ts`
- `test/unit-g-stor-013-crash-recovery-wal-version-chain.ts`
- `test/unit-g-stor-015-pending-confirmed-read-strategy.ts`

## TPC-C Like Conflict Baseline
- attempted: 1800
- committed: 1200
- aborted: 600
- conflicts: 600
- throughputTps: 42.936
- consistencyErrors: 0

## TPC-C Like Soak (30s)
- runs: 9
- attempted: 2250
- committed: 1800
- aborted: 450
- conflicts: 450
- consistencyErrors: 0

## Artifacts
- Folder: `reports/p2-evidence/20260317-111319-p2-mile-008/`
- `acceptance-suite.log`
- `tpcc-conflict-baseline.json`
- `tpcc-soak.json`
- `evidence-summary.json`
- `p2-mile-008-txn-conflict-recovery-report.md`

## Automation Added
- Script: `scripts/p2-evidence-txn-conflict-recovery.ps1`
- It automates build + acceptance subset + benchmark + soak + summary generation.

## Conclusion
With MILE-007 (on-chain tx proofs) + MILE-008 (txn/conflict/recovery evidence), Phase-2 now has a fuller evidence chain for both **real-network execution proof** and **transaction consistency under conflict/soak pressure**.
