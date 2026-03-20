import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "./client.js";

type InternalTableStore = {
  tables: Map<string, Array<Record<string, number | string | null>>>;
};

export interface P3Bench001NoIndexConfig {
  customers: number;
  ordersPerCustomer: number;
  refundEveryNOrders: number;
  warmupRounds: number;
  measuredRounds: number;
}

export interface P3Bench001NoIndexReport {
  benchmark: "p3-bench-001-no-index-complex-query-baseline";
  at: string;
  config: P3Bench001NoIndexConfig;
  dataset: {
    customers: number;
    orders: number;
    refunds: number;
  };
  query: {
    sql: string;
    warmupRounds: number;
    measuredRounds: number;
    explain: {
      physicalOptimizerAccessPath: string;
      physicalOptimizerIndexStrategy: string;
      physicalAccessPath: string;
      physicalIndexStrategy: string;
      physicalJoinAlgorithms: string;
    };
  };
  performance: {
    queryCount: number;
    totalDurationMs: number;
    throughputQps: number;
    avgLatencyMs: number;
    minLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
  };
  execution: {
    resultRows: number;
    totalRowsReturned: number;
    rowsVisited: number;
    rowsVisitedPerQuery: number;
    lastRowsVisited: number;
    pipelinedExecutions: number;
    materializedExecutions: number;
  };
  noIndexEvidence: {
    indexObservabilityEntries: number;
    lookupCountTotal: number;
    maintenanceRowsTotal: number;
    noIndexObserved: boolean;
  };
}

export type P3BenchReport = P3Bench001NoIndexReport;

const defaultP3Bench001Config: P3Bench001NoIndexConfig = {
  customers: 600,
  ordersPerCustomer: 10,
  refundEveryNOrders: 5,
  warmupRounds: 3,
  measuredRounds: 12,
};

const BENCH_TABLES = {
  customers: "p3_bench1_customers",
  orders: "p3_bench1_orders",
  refunds: "p3_bench1_refunds",
} as const;

function mkClient(): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
  });
}

function toQps(operations: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Number(((operations * 1000) / durationMs).toFixed(3));
}

function toLatencyPercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const p = Math.max(0, Math.min(100, percentile));
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, idx)] ?? 0;
}

function toFixed(value: number): number {
  return Number(value.toFixed(3));
}

export async function runP3Bench001NoIndexComplexBaseline(
  config?: Partial<P3Bench001NoIndexConfig>,
): Promise<P3Bench001NoIndexReport> {
  const c: P3Bench001NoIndexConfig = {
    customers: Math.max(50, config?.customers ?? defaultP3Bench001Config.customers),
    ordersPerCustomer: Math.max(2, config?.ordersPerCustomer ?? defaultP3Bench001Config.ordersPerCustomer),
    refundEveryNOrders: Math.max(2, config?.refundEveryNOrders ?? defaultP3Bench001Config.refundEveryNOrders),
    warmupRounds: Math.max(1, config?.warmupRounds ?? defaultP3Bench001Config.warmupRounds),
    measuredRounds: Math.max(5, config?.measuredRounds ?? defaultP3Bench001Config.measuredRounds),
  };

  const db = mkClient();

  await db.execute(`CREATE TABLE ${BENCH_TABLES.customers} (id INT, tier INT, region TEXT)`);
  await db.execute(`CREATE TABLE ${BENCH_TABLES.orders} (id INT, customer_id INT, amount INT, status TEXT)`);
  await db.execute(`CREATE TABLE ${BENCH_TABLES.refunds} (id INT, order_id INT, refund_amount INT)`);

  const customerRows = new Array<Record<string, number | string | null>>(c.customers);
  const orderRows = new Array<Record<string, number | string | null>>(c.customers * c.ordersPerCustomer);
  const refundRows: Array<Record<string, number | string | null>> = [];

  const regions = ["APAC", "EU", "LATAM", "NA"] as const;
  const statuses = ["paid", "shipped", "draft", "paid", "cancelled", "paid"] as const;

  let orderId = 1;
  let refundId = 1;
  for (let customerId = 1; customerId <= c.customers; customerId += 1) {
    customerRows[customerId - 1] = {
      id: customerId,
      tier: (customerId % 5) + 1,
      region: regions[customerId % regions.length] ?? "NA",
    };

    for (let i = 0; i < c.ordersPerCustomer; i += 1) {
      const amount = 20 + ((customerId * 17 + i * 31 + orderId) % 900);
      orderRows[orderId - 1] = {
        id: orderId,
        customer_id: customerId,
        amount,
        status: statuses[(orderId + customerId + i) % statuses.length] ?? "paid",
      };

      if (orderId % c.refundEveryNOrders === 0) {
        refundRows.push({
          id: refundId,
          order_id: orderId,
          refund_amount: Math.max(1, Math.floor(amount / 8)),
        });
        refundId += 1;
      }

      orderId += 1;
    }
  }

  (db as unknown as InternalTableStore).tables.set(BENCH_TABLES.customers, customerRows);
  (db as unknown as InternalTableStore).tables.set(BENCH_TABLES.orders, orderRows);
  (db as unknown as InternalTableStore).tables.set(BENCH_TABLES.refunds, refundRows);

  const sql =
    "SELECT customer_id, SUM(amount) " +
    `FROM ${BENCH_TABLES.customers} ` +
    `INNER JOIN ${BENCH_TABLES.orders} ON ${BENCH_TABLES.customers}.id = ${BENCH_TABLES.orders}.customer_id ` +
    `LEFT JOIN ${BENCH_TABLES.refunds} ON ${BENCH_TABLES.orders}.id = ${BENCH_TABLES.refunds}.order_id ` +
    `WHERE ${BENCH_TABLES.orders}.status IN ('paid','shipped') AND ${BENCH_TABLES.customers}.tier <= 3 ` +
    "GROUP BY customer_id " +
    "ORDER BY sum DESC, customer_id ASC LIMIT 50";

  const explainRow = (await db.query(`EXPLAIN ${sql}`)).rows[0] ?? {};

  for (let i = 0; i < c.warmupRounds; i += 1) {
    await db.query(sql);
  }

  const warmedStats = db.getSelectExecutionPipelineStats(sql)[0];
  const rowsVisitedBefore = warmedStats?.rowsVisited ?? 0;
  const pipelinedBefore = warmedStats?.pipelinedExecutions ?? 0;
  const materializedBefore = warmedStats?.materializedExecutions ?? 0;

  const latenciesMs: number[] = [];
  let expectedResultRows = -1;
  let totalRowsReturned = 0;

  const started = performance.now();
  for (let i = 0; i < c.measuredRounds; i += 1) {
    const queryStarted = performance.now();
    const result = await db.query(sql);
    const elapsed = performance.now() - queryStarted;
    latenciesMs.push(elapsed);

    if (expectedResultRows < 0) expectedResultRows = result.rows.length;
    else if (result.rows.length !== expectedResultRows) {
      throw new Error(
        `P3-BENCH-001 result-size instability: expected=${expectedResultRows} actual=${result.rows.length} round=${i + 1}`,
      );
    }
    totalRowsReturned += result.rows.length;
  }
  const totalDurationMs = performance.now() - started;

  const afterStats = db.getSelectExecutionPipelineStats(sql)[0];
  const rowsVisitedAfter = afterStats?.rowsVisited ?? 0;
  const pipelinedAfter = afterStats?.pipelinedExecutions ?? 0;
  const materializedAfter = afterStats?.materializedExecutions ?? 0;
  const rowsVisitedDelta = Math.max(0, rowsVisitedAfter - rowsVisitedBefore);

  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const avgLatencyMs = latenciesMs.reduce((sum, value) => sum + value, 0) / Math.max(1, latenciesMs.length);
  const minLatencyMs = sortedLatencies[0] ?? 0;
  const maxLatencyMs = sortedLatencies[sortedLatencies.length - 1] ?? 0;
  const p50LatencyMs = toLatencyPercentile(sortedLatencies, 50);
  const p95LatencyMs = toLatencyPercentile(sortedLatencies, 95);
  const p99LatencyMs = toLatencyPercentile(sortedLatencies, 99);

  const indexObservability = db.getIndexObservability();
  const lookupCountTotal = indexObservability.reduce((sum, row) => sum + row.lookupCount, 0);
  const maintenanceRowsTotal = indexObservability.reduce((sum, row) => sum + row.maintenanceRows, 0);
  const noIndexObserved =
    indexObservability.length === 0 || (lookupCountTotal === 0 && maintenanceRowsTotal === 0);

  return {
    benchmark: "p3-bench-001-no-index-complex-query-baseline",
    at: new Date().toISOString(),
    config: c,
    dataset: {
      customers: customerRows.length,
      orders: orderRows.length,
      refunds: refundRows.length,
    },
    query: {
      sql,
      warmupRounds: c.warmupRounds,
      measuredRounds: c.measuredRounds,
      explain: {
        physicalOptimizerAccessPath: String(explainRow.physicalOptimizerAccessPath ?? ""),
        physicalOptimizerIndexStrategy: String(explainRow.physicalOptimizerIndexStrategy ?? ""),
        physicalAccessPath: String(explainRow.physicalAccessPath ?? ""),
        physicalIndexStrategy: String(explainRow.physicalIndexStrategy ?? ""),
        physicalJoinAlgorithms: String(explainRow.physicalJoinAlgorithms ?? ""),
      },
    },
    performance: {
      queryCount: c.measuredRounds,
      totalDurationMs: toFixed(totalDurationMs),
      throughputQps: toQps(c.measuredRounds, totalDurationMs),
      avgLatencyMs: toFixed(avgLatencyMs),
      minLatencyMs: toFixed(minLatencyMs),
      p50LatencyMs: toFixed(p50LatencyMs),
      p95LatencyMs: toFixed(p95LatencyMs),
      p99LatencyMs: toFixed(p99LatencyMs),
      maxLatencyMs: toFixed(maxLatencyMs),
    },
    execution: {
      resultRows: Math.max(0, expectedResultRows),
      totalRowsReturned,
      rowsVisited: rowsVisitedDelta,
      rowsVisitedPerQuery: toFixed(rowsVisitedDelta / Math.max(1, c.measuredRounds)),
      lastRowsVisited: afterStats?.lastRowsVisited ?? 0,
      pipelinedExecutions: Math.max(0, pipelinedAfter - pipelinedBefore),
      materializedExecutions: Math.max(0, materializedAfter - materializedBefore),
    },
    noIndexEvidence: {
      indexObservabilityEntries: indexObservability.length,
      lookupCountTotal,
      maintenanceRowsTotal,
      noIndexObserved,
    },
  };
}

export async function writeP3BenchReport(path: string, report: P3BenchReport): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
