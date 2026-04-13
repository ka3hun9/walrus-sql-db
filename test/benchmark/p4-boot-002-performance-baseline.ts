import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import type { SqlErrorCode } from "../../src/sql-errors.js";
import { WalrusSqlClient } from "../../src/client.js";

type InternalTableStore = {
  tables: Map<string, Array<Record<string, number | string | null>>>;
};

const WINDOW_TABLE = "p4_boot2_window_scores";
const WINDOW_SQL =
  `SELECT grp, id, score, ROW_NUMBER() OVER (PARTITION BY grp ORDER BY score DESC, id ASC) AS rn ` +
  `FROM ${WINDOW_TABLE} ORDER BY grp ASC, rn ASC LIMIT 180`;
const RECURSIVE_CTE_SQL =
  "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 16) SELECT n FROM seq";
const DYNAMIC_SQL_PROBES = [
  "PREPARE p4_boot2_stmt AS SELECT id FROM p4_boot2_window_scores",
] as const;

export const P4_BOOT_002_REPORT_PATH = "reports/p4-boot-002-performance-baseline.json";
export const P4_BOOT_002_HISTORY_PATH = "reports/p4-boot-002-performance-tracking.jsonl";

export interface P4Boot002Config {
  windowRows: number;
  windowWarmupRounds: number;
  windowMeasuredRounds: number;
  recursiveCteProbeRounds: number;
  dynamicSqlProbeRounds: number;
}

export interface P4Boot002LatencyStats {
  operations: number;
  totalDurationMs: number;
  throughputOpsPerSec: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
}

export interface P4Boot002WindowBaseline {
  mode: "supported";
  sql: string;
  datasetRows: number;
  warmupRounds: number;
  measuredRounds: number;
  resultRows: number;
  performance: P4Boot002LatencyStats;
  execution: {
    rowsVisited: number;
    rowsVisitedPerQuery: number;
    lastRowsVisited: number;
    pipelinedExecutions: number;
    materializedExecutions: number;
  };
}

export interface P4Boot002UnsupportedBaseline {
  mode: "expected_error_probe";
  sql: string[];
  probeRounds: number;
  expectedErrorCode: SqlErrorCode;
  rejected: number;
  observedTokens: string[];
  performance: P4Boot002LatencyStats;
}

export interface P4Boot002BenchmarkReport {
  benchmark: "p4-boot-002-performance-baseline";
  at: string;
  nodeVersion: string;
  config: P4Boot002Config;
  windowFunction: P4Boot002WindowBaseline;
  recursiveCte: P4Boot002UnsupportedBaseline;
  dynamicSql: P4Boot002UnsupportedBaseline;
  tracking: {
    reportPath: string;
    historyPath: string;
    baselineMode: "hybrid_supported_and_expected_error";
  };
}

export interface P4Boot002TrackingSample {
  at: string;
  benchmark: P4Boot002BenchmarkReport["benchmark"];
  windowThroughputQps: number;
  windowP95LatencyMs: number;
  recursiveCteRejectOpsPerSec: number;
  dynamicSqlRejectOpsPerSec: number;
  recursiveObservedTokens: string[];
  dynamicObservedTokens: string[];
}

type UnsupportedProbeOptions = {
  sql: readonly string[];
  rounds: number;
  expectedCode: SqlErrorCode;
  expectedTokens: readonly string[];
};

const defaultConfig: P4Boot002Config = {
  windowRows: 1800,
  windowWarmupRounds: 2,
  windowMeasuredRounds: 12,
  recursiveCteProbeRounds: 36,
  dynamicSqlProbeRounds: 36,
};

function mkClient(): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
  });
}

function toFixed(value: number): number {
  return Number(value.toFixed(3));
}

function toThroughput(operations: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return toFixed((operations * 1000) / durationMs);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function summarizeLatencies(latenciesMs: number[], totalDurationMs: number): P4Boot002LatencyStats {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const avg = latenciesMs.reduce((sum, item) => sum + item, 0) / Math.max(1, latenciesMs.length);
  return {
    operations: latenciesMs.length,
    totalDurationMs: toFixed(totalDurationMs),
    throughputOpsPerSec: toThroughput(latenciesMs.length, totalDurationMs),
    avgLatencyMs: toFixed(avg),
    minLatencyMs: toFixed(sorted[0] ?? 0),
    p50LatencyMs: toFixed(percentile(sorted, 50)),
    p95LatencyMs: toFixed(percentile(sorted, 95)),
    p99LatencyMs: toFixed(percentile(sorted, 99)),
    maxLatencyMs: toFixed(sorted[sorted.length - 1] ?? 0),
  };
}

function buildWindowRows(totalRows: number): Array<Record<string, number | string | null>> {
  const groups = 12;
  const rows = new Array<Record<string, number | string | null>>(totalRows);
  for (let id = 1; id <= totalRows; id += 1) {
    rows[id - 1] = {
      id,
      grp: `G${(id - 1) % groups}`,
      score: (id * 17) % 997,
    };
  }
  return rows;
}

async function runWindowBaseline(db: WalrusSqlClient, config: P4Boot002Config): Promise<P4Boot002WindowBaseline> {
  await db.execute(`CREATE TABLE ${WINDOW_TABLE} (id INT PRIMARY KEY, grp TEXT, score INT)`);
  (db as unknown as InternalTableStore).tables.set(WINDOW_TABLE, buildWindowRows(config.windowRows));

  for (let i = 0; i < config.windowWarmupRounds; i += 1) {
    await db.query(WINDOW_SQL);
  }

  const beforeStats = db.getSelectExecutionPipelineStats(WINDOW_SQL)[0];
  const rowsVisitedBefore = beforeStats?.rowsVisited ?? 0;
  const pipelinedBefore = beforeStats?.pipelinedExecutions ?? 0;
  const materializedBefore = beforeStats?.materializedExecutions ?? 0;

  const latenciesMs: number[] = [];
  let expectedRows = -1;

  const startedAt = performance.now();
  for (let i = 0; i < config.windowMeasuredRounds; i += 1) {
    const t0 = performance.now();
    const out = await db.query(WINDOW_SQL);
    latenciesMs.push(performance.now() - t0);

    if (expectedRows < 0) {
      expectedRows = out.rows.length;
    } else if (out.rows.length !== expectedRows) {
      throw new Error(
        `P4-BOOT-002 window result-size instability: expected=${expectedRows} actual=${out.rows.length} round=${i + 1}`,
      );
    }
  }
  const totalDurationMs = performance.now() - startedAt;

  const afterStats = db.getSelectExecutionPipelineStats(WINDOW_SQL)[0];
  const rowsVisitedAfter = afterStats?.rowsVisited ?? 0;
  const pipelinedAfter = afterStats?.pipelinedExecutions ?? 0;
  const materializedAfter = afterStats?.materializedExecutions ?? 0;
  const rowsVisitedDelta = Math.max(0, rowsVisitedAfter - rowsVisitedBefore);

  return {
    mode: "supported",
    sql: WINDOW_SQL,
    datasetRows: config.windowRows,
    warmupRounds: config.windowWarmupRounds,
    measuredRounds: config.windowMeasuredRounds,
    resultRows: Math.max(0, expectedRows),
    performance: summarizeLatencies(latenciesMs, totalDurationMs),
    execution: {
      rowsVisited: rowsVisitedDelta,
      rowsVisitedPerQuery: toFixed(rowsVisitedDelta / Math.max(1, config.windowMeasuredRounds)),
      lastRowsVisited: afterStats?.lastRowsVisited ?? 0,
      pipelinedExecutions: Math.max(0, pipelinedAfter - pipelinedBefore),
      materializedExecutions: Math.max(0, materializedAfter - materializedBefore),
    },
  };
}

function readSqlErrorCode(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  return String((err as { code?: unknown }).code ?? "");
}

function readSqlErrorToken(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const details = (err as { details?: { token?: unknown } }).details;
  return String(details?.token ?? "");
}

async function runUnsupportedProbe(
  db: WalrusSqlClient,
  options: UnsupportedProbeOptions,
): Promise<P4Boot002UnsupportedBaseline> {
  const latenciesMs: number[] = [];
  const observedTokens = new Set<string>();

  const startedAt = performance.now();
  for (let i = 0; i < options.rounds; i += 1) {
    const sql = options.sql[i % options.sql.length]!;
    const t0 = performance.now();

    try {
      await db.query(sql);
      throw new Error(`P4-BOOT-002 expected error but succeeded: sql=${sql}`);
    } catch (err) {
      const elapsed = performance.now() - t0;
      latenciesMs.push(elapsed);

      const code = readSqlErrorCode(err);
      const token = readSqlErrorToken(err);
      if (token) observedTokens.add(token);

      if (code !== options.expectedCode) {
        throw new Error(
          `P4-BOOT-002 unsupported probe error-code mismatch: expected=${options.expectedCode} actual=${code} sql=${sql}`,
        );
      }

      if (options.expectedTokens.length > 0) {
        const tokenUpper = token.toUpperCase();
        const allowed = options.expectedTokens.some((item) => item.toUpperCase() === tokenUpper);
        if (!allowed) {
          throw new Error(
            `P4-BOOT-002 unsupported probe token mismatch: token=${token || "<empty>"}, sql=${sql}`,
          );
        }
      }
    }
  }
  const totalDurationMs = performance.now() - startedAt;

  return {
    mode: "expected_error_probe",
    sql: [...options.sql],
    probeRounds: options.rounds,
    expectedErrorCode: options.expectedCode,
    rejected: options.rounds,
    observedTokens: [...observedTokens].sort(),
    performance: summarizeLatencies(latenciesMs, totalDurationMs),
  };
}

export async function runP4Boot002PerformanceBaseline(
  config?: Partial<P4Boot002Config>,
): Promise<P4Boot002BenchmarkReport> {
  const c: P4Boot002Config = {
    windowRows: Math.max(600, Math.floor(config?.windowRows ?? defaultConfig.windowRows)),
    windowWarmupRounds: Math.max(1, Math.floor(config?.windowWarmupRounds ?? defaultConfig.windowWarmupRounds)),
    windowMeasuredRounds: Math.max(6, Math.floor(config?.windowMeasuredRounds ?? defaultConfig.windowMeasuredRounds)),
    recursiveCteProbeRounds: Math.max(
      12,
      Math.floor(config?.recursiveCteProbeRounds ?? defaultConfig.recursiveCteProbeRounds),
    ),
    dynamicSqlProbeRounds: Math.max(12, Math.floor(config?.dynamicSqlProbeRounds ?? defaultConfig.dynamicSqlProbeRounds)),
  };

  const db = mkClient();
  const windowFunction = await runWindowBaseline(db, c);

  const recursiveCte = await runUnsupportedProbe(db, {
    sql: [RECURSIVE_CTE_SQL],
    rounds: c.recursiveCteProbeRounds,
    expectedCode: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
    expectedTokens: ["cte"],
  });

  const dynamicSql = await runUnsupportedProbe(db, {
    sql: DYNAMIC_SQL_PROBES,
    rounds: c.dynamicSqlProbeRounds,
    expectedCode: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
    expectedTokens: ["PREPARE", "EXECUTE"],
  });

  return {
    benchmark: "p4-boot-002-performance-baseline",
    at: new Date().toISOString(),
    nodeVersion: process.version,
    config: c,
    windowFunction,
    recursiveCte,
    dynamicSql,
    tracking: {
      reportPath: P4_BOOT_002_REPORT_PATH,
      historyPath: P4_BOOT_002_HISTORY_PATH,
      baselineMode: "hybrid_supported_and_expected_error",
    },
  };
}

export async function writeP4Boot002PerformanceReport(
  outputPath: string,
  report: P4Boot002BenchmarkReport,
): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function appendP4Boot002TrackingSample(
  historyPath: string,
  report: P4Boot002BenchmarkReport,
): Promise<P4Boot002TrackingSample> {
  const sample: P4Boot002TrackingSample = {
    at: new Date().toISOString(),
    benchmark: report.benchmark,
    windowThroughputQps: report.windowFunction.performance.throughputOpsPerSec,
    windowP95LatencyMs: report.windowFunction.performance.p95LatencyMs,
    recursiveCteRejectOpsPerSec: report.recursiveCte.performance.throughputOpsPerSec,
    dynamicSqlRejectOpsPerSec: report.dynamicSql.performance.throughputOpsPerSec,
    recursiveObservedTokens: report.recursiveCte.observedTokens,
    dynamicObservedTokens: report.dynamicSql.observedTokens,
  };

  await fs.mkdir(dirname(historyPath), { recursive: true });
  await fs.appendFile(historyPath, `${JSON.stringify(sample)}\n`, "utf8");

  return sample;
}
