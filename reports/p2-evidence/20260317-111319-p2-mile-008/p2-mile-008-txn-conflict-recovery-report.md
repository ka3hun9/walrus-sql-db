# P2 Mile-008 Txn Conflict & Recovery Evidence Report

- generatedAt: 2026-03-17T11:14:43.3784339+08:00
- network: testnet
- acceptance passed: True
- tpcc conflict consistency errors: 0
- tpcc soak consistency errors: 0
- overall: True

## TPCC Conflict Baseline
- attempted=1800, committed=1200, aborted=600
- conflicts=600, throughputTps=42.936

## TPCC Soak
- durationMs=30000, runs=9
- attempted=2250, committed=1800, aborted=450, conflicts=450

## Artifacts
- acceptance-suite.log
- tpcc-conflict-baseline.json
- tpcc-soak.json
- evidence-summary.json

