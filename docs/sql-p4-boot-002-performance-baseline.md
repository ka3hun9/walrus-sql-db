# P4 Performance Baseline Bootstrap Report

## P4-BOOT-002

## Scope
- Objective: establish a reusable Phase-4 performance baseline before full feature completion.
- Baseline dimensions in this boot item:
  - window-function runtime baseline (`ROW_NUMBER() OVER (...)`) with throughput/latency;
  - recursive CTE expected-error probe baseline (until recursive CTE execution support lands);
  - dynamic SQL expected-error probe baseline (`PREPARE` / `EXECUTE`) until statement lifecycle support lands.

## Benchmark Environment
- Core benchmark module:
  - `test/benchmark/p4-boot-002-performance-baseline.ts`
- Canonical runner:
  - `examples/p4-boot-002-performance-baseline.ts`
- Unit gate:
  - `test/unit-p4-boot-002-performance-baseline.ts`

## Report And Continuous Tracking Paths
- Canonical benchmark report:
  - `reports/p4-boot-002-performance-baseline.json`
- Continuous tracking history (JSONL append-only):
  - `reports/p4-boot-002-performance-tracking.jsonl`

## Commands
- `npm run build`
- `npm run sql:p4:bench:boot`
- `npx tsx test/unit-p4-boot-002-performance-baseline.ts`

## Result
- Benchmark environment is runnable and produces a structured JSON baseline report.
- Window-function path records throughput/latency metrics.
- Recursive CTE and dynamic SQL are tracked via deterministic expected-error probe metrics and trend snapshots.
- Continuous tracking is enabled by appending each run into the JSONL history path.
- Verdict: `PASS`.
