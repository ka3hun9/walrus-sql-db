import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "./client.js";

export interface TpccLikeBenchmarkConfig {
  warehouses: number;
  customersPerWarehouse: number;
  transactions: number;
  conflictEvery: number;
  amountStep: number;
}

export interface TpccLikeBenchmarkReport {
  generatedAt: string;
  nodeVersion: string;
  config: TpccLikeBenchmarkConfig;
  attemptedTransactions: number;
  committedTransactions: number;
  abortedTransactions: number;
  abortRatio: number;
  conflictsDetected: number;
  throughputTps: number;
  latencyMs: {
    avg: number;
    p95: number;
    max: number;
  };
  consistencyErrors: string[];
}

export interface TpccLikeSoakConfig {
  durationMs: number;
  runConfig?: Partial<TpccLikeBenchmarkConfig>;
}

export interface TpccLikeSoakReport {
  generatedAt: string;
  nodeVersion: string;
  durationMs: number;
  runs: number;
  totalAttempted: number;
  totalCommitted: number;
  totalAborted: number;
  totalConflicts: number;
  consistencyErrors: string[];
}

const DEFAULT_CONFIG: TpccLikeBenchmarkConfig = {
  warehouses: 1,
  customersPerWarehouse: 200,
  transactions: 400,
  conflictEvery: 5,
  amountStep: 5,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx]!.toFixed(3));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function shareCommittedStore(source: WalrusSqlClient, target: WalrusSqlClient): void {
  const src = source as unknown as Record<string, unknown>;
  const dst = target as unknown as Record<string, unknown>;
  dst.tables = src.tables;
  dst.schemas = src.schemas;
  dst.uniqueIndexes = src.uniqueIndexes;
  dst.uniqueGroupsCache = src.uniqueGroupsCache;
  dst.constraintCost = src.constraintCost;
  dst.rowVersions = src.rowVersions;
  dst.tableVersionObjects = src.tableVersionObjects;
}

function mergeConfig(config?: Partial<TpccLikeBenchmarkConfig>): TpccLikeBenchmarkConfig {
  return {
    warehouses: Math.max(1, Math.floor(config?.warehouses ?? DEFAULT_CONFIG.warehouses)),
    customersPerWarehouse: Math.max(1, Math.floor(config?.customersPerWarehouse ?? DEFAULT_CONFIG.customersPerWarehouse)),
    transactions: Math.max(1, Math.floor(config?.transactions ?? DEFAULT_CONFIG.transactions)),
    conflictEvery: Math.max(0, Math.floor(config?.conflictEvery ?? DEFAULT_CONFIG.conflictEvery)),
    amountStep: Math.max(1, Math.floor(config?.amountStep ?? DEFAULT_CONFIG.amountStep)),
  };
}

export async function runTpccLikeBenchmark(
  config?: Partial<TpccLikeBenchmarkConfig>,
): Promise<TpccLikeBenchmarkReport> {
  const merged = mergeConfig(config);
  const primary = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    isolationLevel: "read_committed",
    readCache: { enabled: false },
  });
  const racer = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    isolationLevel: "read_committed",
    readCache: { enabled: false },
  });
  shareCommittedStore(primary, racer);

  await primary.execute("CREATE TABLE tpcc_wh (id INT PRIMARY KEY, ytd INT)");
  await primary.execute("CREATE TABLE tpcc_cust (id INT PRIMARY KEY, wh_id INT, balance INT)");
  await primary.execute("CREATE TABLE tpcc_ord (id INT PRIMARY KEY, cust_id INT, amount INT)");

  for (let wid = 1; wid <= merged.warehouses; wid++) {
    await primary.execute(`INSERT INTO tpcc_wh (id, ytd) VALUES (${wid}, 0)`);
    for (let c = 1; c <= merged.customersPerWarehouse; c++) {
      const custId = ((wid - 1) * merged.customersPerWarehouse) + c;
      await primary.execute(`INSERT INTO tpcc_cust (id, wh_id, balance) VALUES (${custId}, ${wid}, 0)`);
    }
  }

  const latencies: number[] = [];
  let attempted = 0;
  let committed = 0;
  let aborted = 0;
  let conflicts = 0;
  let nextOrderId = 1;
  const overallStart = performance.now();

  const runNormalTx = async (txNo: number): Promise<void> => {
    const start = performance.now();
    const whId = ((txNo - 1) % merged.warehouses) + 1;
    const localCustomer = ((txNo - 1) % merged.customersPerWarehouse) + 1;
    const custId = ((whId - 1) * merged.customersPerWarehouse) + localCustomer;
    const amount = ((txNo % 7) + 1) * merged.amountStep;
    const balRow = await primary.query(`SELECT balance FROM tpcc_cust WHERE id = ${custId}`);
    const whRow = await primary.query(`SELECT ytd FROM tpcc_wh WHERE id = ${whId}`);
    const nextBalance = Number(balRow.rows[0]?.balance ?? 0) + amount;
    const nextYtd = Number(whRow.rows[0]?.ytd ?? 0) + amount;

    attempted += 1;
    await primary.execute("BEGIN");
    try {
      await primary.execute(`UPDATE tpcc_cust SET balance = ${nextBalance} WHERE id = ${custId}`);
      await primary.execute(`UPDATE tpcc_wh SET ytd = ${nextYtd} WHERE id = ${whId}`);
      await primary.execute(`INSERT INTO tpcc_ord (id, cust_id, amount) VALUES (${nextOrderId}, ${custId}, ${amount})`);
      nextOrderId += 1;
      await primary.execute("COMMIT");
      committed += 1;
    } catch {
      aborted += 1;
      try {
        await primary.execute("ROLLBACK");
      } catch {
        // no-op
      }
    }
    latencies.push(round(performance.now() - start));
  };

  const runConflictTx = async (txNo: number): Promise<void> => {
    const start = performance.now();
    const whId = ((txNo - 1) % merged.warehouses) + 1;
    const targetCust = ((whId - 1) * merged.customersPerWarehouse) + 1;
    const amount = ((txNo % 5) + 1) * merged.amountStep;
    const balRow = await primary.query(`SELECT balance FROM tpcc_cust WHERE id = ${targetCust}`);
    const whRow = await primary.query(`SELECT ytd FROM tpcc_wh WHERE id = ${whId}`);
    const baseBalance = Number(balRow.rows[0]?.balance ?? 0);
    const baseYtd = Number(whRow.rows[0]?.ytd ?? 0);

    attempted += 2;
    await primary.execute("BEGIN");
    await racer.execute("BEGIN");

    try {
      await primary.execute(`UPDATE tpcc_cust SET balance = ${baseBalance + amount} WHERE id = ${targetCust}`);
      await primary.execute(`UPDATE tpcc_wh SET ytd = ${baseYtd + amount} WHERE id = ${whId}`);
      await primary.execute(`INSERT INTO tpcc_ord (id, cust_id, amount) VALUES (${nextOrderId}, ${targetCust}, ${amount})`);
      nextOrderId += 1;

      await racer.execute(`UPDATE tpcc_cust SET balance = ${baseBalance + amount + 1} WHERE id = ${targetCust}`);
      await primary.execute("COMMIT");
      committed += 1;
      await racer.execute("COMMIT");
      committed += 1;
    } catch {
      conflicts += 1;
      aborted += 1;
      try {
        await racer.execute("ROLLBACK");
      } catch {
        // no-op
      }
    } finally {
      latencies.push(round(performance.now() - start));
    }
  };

  for (let i = 1; i <= merged.transactions; i++) {
    const shouldConflict = merged.conflictEvery > 0 && (i % merged.conflictEvery) === 0;
    if (shouldConflict) await runConflictTx(i);
    else await runNormalTx(i);
  }

  const totalDurationMs = Math.max(1, performance.now() - overallStart);
  const throughputTps = round((committed * 1_000) / totalDurationMs);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  const consistencyErrors: string[] = [];
  const whRows = await primary.query("SELECT ytd FROM tpcc_wh");
  const custRows = await primary.query("SELECT balance FROM tpcc_cust");
  const ordRows = await primary.query("SELECT amount FROM tpcc_ord");
  const ytdTotal = whRows.rows.reduce((sum, row) => sum + Number((row.ytd ?? 0) as number), 0);
  const custTotal = custRows.rows.reduce((sum, row) => sum + Number((row.balance ?? 0) as number), 0);
  const orderTotal = ordRows.rows.reduce((sum, row) => sum + Number((row.amount ?? 0) as number), 0);
  const orderCount = ordRows.rows.length;

  if (ytdTotal !== custTotal) consistencyErrors.push(`warehouse ytd total mismatch: ytd=${ytdTotal}, cust=${custTotal}`);
  if (ytdTotal !== orderTotal) consistencyErrors.push(`warehouse ytd vs order sum mismatch: ytd=${ytdTotal}, orders=${orderTotal}`);
  if (orderCount !== committed) consistencyErrors.push(`order count mismatch: orders=${orderCount}, committed=${committed}`);

  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    config: merged,
    attemptedTransactions: attempted,
    committedTransactions: committed,
    abortedTransactions: aborted,
    abortRatio: attempted > 0 ? round(aborted / attempted) : 0,
    conflictsDetected: conflicts,
    throughputTps,
    latencyMs: {
      avg: latencies.length > 0 ? round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length) : 0,
      p95: percentile(sortedLatencies, 95),
      max: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1]! : 0,
    },
    consistencyErrors,
  };
}

export async function writeTpccLikeBenchmarkReport(
  outputPath: string,
  report: TpccLikeBenchmarkReport,
): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runTpccLikeSoakBenchmark(config?: Partial<TpccLikeSoakConfig>): Promise<TpccLikeSoakReport> {
  const durationMs = Math.max(1, Math.floor(config?.durationMs ?? 60_000));
  const startedAt = Date.now();
  let runs = 0;
  let totalAttempted = 0;
  let totalCommitted = 0;
  let totalAborted = 0;
  let totalConflicts = 0;
  const consistencyErrors: string[] = [];

  while ((Date.now() - startedAt) < durationMs) {
    const report = await runTpccLikeBenchmark(config?.runConfig);
    runs += 1;
    totalAttempted += report.attemptedTransactions;
    totalCommitted += report.committedTransactions;
    totalAborted += report.abortedTransactions;
    totalConflicts += report.conflictsDetected;
    if (report.consistencyErrors.length > 0) {
      consistencyErrors.push(`run#${runs}: ${report.consistencyErrors.join("; ")}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    durationMs,
    runs,
    totalAttempted,
    totalCommitted,
    totalAborted,
    totalConflicts,
    consistencyErrors,
  };
}

export async function writeTpccLikeSoakReport(outputPath: string, report: TpccLikeSoakReport): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
