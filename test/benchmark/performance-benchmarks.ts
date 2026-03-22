import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { WalrusSqlClientOptions } from "../../src/types.js";
import { WalrusSqlClient } from "../../src/client.js";

export interface PerformanceBenchmarkConfig {
  writeRows: number;
  coldQueries: number;
  hotQueries: number;
}

export interface PerformanceBenchmarkSample {
  name: "write_throughput" | "cold_query_throughput" | "hot_query_throughput";
  operations: number;
  durationMs: number;
  opsPerSec: number;
}

export interface PerformanceBenchmarkReport {
  generatedAt: string;
  nodeVersion: string;
  config: PerformanceBenchmarkConfig;
  samples: PerformanceBenchmarkSample[];
}

export interface TypedValuePerformanceThreshold {
  minOpsPerSecRatio: number;
}

export interface TypedValuePerformanceGatePolicy {
  write_throughput: TypedValuePerformanceThreshold;
  cold_query_throughput: TypedValuePerformanceThreshold;
  hot_query_throughput: TypedValuePerformanceThreshold;
}

export interface TypedValuePerformanceGateCheck {
  name: PerformanceBenchmarkSample["name"];
  baselineOpsPerSec: number;
  currentOpsPerSec: number;
  ratio: number;
  minOpsPerSecRatio: number;
  pass: boolean;
}

export interface TypedValuePerformanceGateResult {
  passed: boolean;
  checks: TypedValuePerformanceGateCheck[];
}

const DEFAULT_CONFIG: PerformanceBenchmarkConfig = {
  writeRows: 1_000,
  coldQueries: 1,
  hotQueries: 1_000,
};

export const DEFAULT_TYPED_VALUE_PERF_POLICY: TypedValuePerformanceGatePolicy = Object.freeze({
  write_throughput: { minOpsPerSecRatio: 0.005 },
  cold_query_throughput: { minOpsPerSecRatio: 0.002 },
  hot_query_throughput: { minOpsPerSecRatio: 0.005 },
});

function elapsedMs(start: number, end: number): number {
  return Number((end - start).toFixed(3));
}

function toOpsPerSec(operations: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Number(((operations * 1_000) / durationMs).toFixed(2));
}

function createBenchClient(overrides?: Partial<WalrusSqlClientOptions>): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    ...overrides,
  });
}

export async function runPerformanceBenchmarks(
  config?: Partial<PerformanceBenchmarkConfig>,
): Promise<PerformanceBenchmarkReport> {
  const merged: PerformanceBenchmarkConfig = {
    writeRows: Math.max(1, config?.writeRows ?? DEFAULT_CONFIG.writeRows),
    coldQueries: Math.max(1, config?.coldQueries ?? DEFAULT_CONFIG.coldQueries),
    hotQueries: Math.max(1, config?.hotQueries ?? DEFAULT_CONFIG.hotQueries),
  };

  const db = createBenchClient();
  await db.execute("CREATE TABLE bench_users (id INT PRIMARY KEY, score FLOAT, team INT)");
  await db.execute("CREATE TABLE bench_teams (id INT PRIMARY KEY, tier INT)");
  for (let i = 1; i <= 20; i++) {
    await db.execute(`INSERT INTO bench_teams (id, tier) VALUES (${i}, ${(i % 4) + 1})`);
  }

  const tInsertStart = performance.now();
  for (let i = 1; i <= merged.writeRows; i++) {
    const team = (i % 20) + 1;
    await db.execute(`INSERT INTO bench_users (id, score, team) VALUES (${i}, ${(i % 100) + 0.5}, ${team})`);
  }
  const tInsertEnd = performance.now();

  const tColdStart = performance.now();
  for (let i = 1; i <= merged.coldQueries; i++) {
    const threshold = ((i - 1) % 100) + 0.5;
    await db.query(
      `SELECT bench_users.id, bench_teams.tier FROM bench_users INNER JOIN bench_teams ON bench_users.team = bench_teams.id WHERE bench_users.score >= ${threshold} ORDER BY bench_users.id ASC LIMIT 30`,
    );
  }
  const tColdEnd = performance.now();

  const hotSql = "SELECT id, score FROM bench_users WHERE score >= 10 ORDER BY id ASC LIMIT 50";
  await db.query(hotSql); // warm-up run excluded from the measured hot loop.

  const tHotStart = performance.now();
  for (let i = 1; i <= merged.hotQueries; i++) {
    await db.query(hotSql);
  }
  const tHotEnd = performance.now();

  const samples: PerformanceBenchmarkSample[] = [
    {
      name: "write_throughput",
      operations: merged.writeRows,
      durationMs: elapsedMs(tInsertStart, tInsertEnd),
      opsPerSec: toOpsPerSec(merged.writeRows, elapsedMs(tInsertStart, tInsertEnd)),
    },
    {
      name: "cold_query_throughput",
      operations: merged.coldQueries,
      durationMs: elapsedMs(tColdStart, tColdEnd),
      opsPerSec: toOpsPerSec(merged.coldQueries, elapsedMs(tColdStart, tColdEnd)),
    },
    {
      name: "hot_query_throughput",
      operations: merged.hotQueries,
      durationMs: elapsedMs(tHotStart, tHotEnd),
      opsPerSec: toOpsPerSec(merged.hotQueries, elapsedMs(tHotStart, tHotEnd)),
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    config: merged,
    samples,
  };
}

export async function writePerformanceBenchmarkReport(outputPath: string, report: PerformanceBenchmarkReport): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function evaluateTypedValuePerformanceRegression(
  current: PerformanceBenchmarkReport,
  baseline: PerformanceBenchmarkReport,
  policy: TypedValuePerformanceGatePolicy = DEFAULT_TYPED_VALUE_PERF_POLICY,
): TypedValuePerformanceGateResult {
  const names: Array<PerformanceBenchmarkSample["name"]> = [
    "write_throughput",
    "cold_query_throughput",
    "hot_query_throughput",
  ];
  const currentByName = new Map(current.samples.map((sample) => [sample.name, sample]));
  const baselineByName = new Map(baseline.samples.map((sample) => [sample.name, sample]));

  const checks = names.map((name): TypedValuePerformanceGateCheck => {
    const currentSample = currentByName.get(name);
    if (!currentSample) throw new Error(`missing current performance sample: ${name}`);
    const baselineSample = baselineByName.get(name);
    if (!baselineSample) throw new Error(`missing baseline performance sample: ${name}`);

    const baselineOpsPerSec = Math.max(0, baselineSample.opsPerSec);
    const currentOpsPerSec = Math.max(0, currentSample.opsPerSec);
    const ratio = baselineOpsPerSec <= 0 ? 1 : Number((currentOpsPerSec / baselineOpsPerSec).toFixed(6));
    const minOpsPerSecRatio = policy[name].minOpsPerSecRatio;
    const pass = ratio >= minOpsPerSecRatio;

    return {
      name,
      baselineOpsPerSec,
      currentOpsPerSec,
      ratio,
      minOpsPerSecRatio,
      pass,
    };
  });

  return {
    passed: checks.every((check) => check.pass),
    checks,
  };
}
