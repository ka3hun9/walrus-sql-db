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

export interface P3Bench002IndexedConfig {
  customers: number;
  ordersPerCustomer: number;
  paidEveryNOrders: number;
  customerRangeStart: number;
  customerRangeEnd: number;
  warmupRounds: number;
  measuredRounds: number;
}

type P3Bench002Explain = {
  physicalOptimizerAccessPath: string;
  physicalOptimizerIndexStrategy: string;
  physicalOptimizerCost: number;
  physicalAccessPath: string;
  physicalIndexStrategy: string;
  physicalCost: number;
  physicalCandidates: string;
};

type P3Bench002Performance = {
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

type P3Bench002Execution = {
  resultRows: number;
  totalRowsReturned: number;
  rowsVisited: number;
  rowsVisitedPerQuery: number;
  lastRowsVisited: number;
  pipelinedExecutions: number;
  materializedExecutions: number;
};

type P3Bench002Observability = {
  indexObservabilityEntries: number;
  lookupCountTotal: number;
  lookupHitsTotal: number;
  lookupMissesTotal: number;
  maintenanceRowsTotal: number;
};

type P3Bench002Scenario = {
  explain: P3Bench002Explain;
  performance: P3Bench002Performance;
  execution: P3Bench002Execution;
  observability: P3Bench002Observability;
};

export interface P3Bench002IndexedReport {
  benchmark: "p3-bench-002-indexed-same-load-benefit";
  at: string;
  config: P3Bench002IndexedConfig;
  dataset: {
    customers: number;
    orders: number;
    paidOrders: number;
  };
  query: {
    sql: string;
    warmupRounds: number;
    measuredRounds: number;
  };
  baseline: P3Bench002Scenario;
  indexed: P3Bench002Scenario & {
    indexBuildMs: number;
    createdIndexes: string[];
  };
  gains: {
    throughputQpsDelta: number;
    throughputQpsGainPct: number;
    p95LatencyMsDelta: number;
    p95LatencyReductionPct: number;
    rowsVisitedPerQueryDelta: number;
    rowsVisitedReductionPct: number;
    physicalCostDelta: number;
    physicalCostReductionPct: number;
  };
}

export type P3BenchReport = P3Bench001NoIndexReport | P3Bench002IndexedReport;

const defaultP3Bench001Config: P3Bench001NoIndexConfig = {
  customers: 600,
  ordersPerCustomer: 10,
  refundEveryNOrders: 5,
  warmupRounds: 3,
  measuredRounds: 12,
};

const defaultP3Bench002Config: P3Bench002IndexedConfig = {
  customers: 1200,
  ordersPerCustomer: 14,
  paidEveryNOrders: 7,
  customerRangeStart: 120,
  customerRangeEnd: 720,
  warmupRounds: 3,
  measuredRounds: 16,
};

const BENCH_TABLES = {
  customers: "p3_bench1_customers",
  orders: "p3_bench1_orders",
  refunds: "p3_bench1_refunds",
} as const;

const BENCH2_TABLE = "p3_bench2_orders";

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

function toFiniteNumber(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function summarizeIndexObservability(
  db: WalrusSqlClient,
  table?: string,
): P3Bench002Observability {
  const rows = db.getIndexObservability(table);
  return {
    indexObservabilityEntries: rows.length,
    lookupCountTotal: rows.reduce((sum, row) => sum + row.lookupCount, 0),
    lookupHitsTotal: rows.reduce((sum, row) => sum + row.lookupHits, 0),
    lookupMissesTotal: rows.reduce((sum, row) => sum + row.lookupMisses, 0),
    maintenanceRowsTotal: rows.reduce((sum, row) => sum + row.maintenanceRows, 0),
  };
}

async function runBench002Scenario(
  db: WalrusSqlClient,
  sql: string,
  warmupRounds: number,
  measuredRounds: number,
  instabilityTag: string,
): Promise<P3Bench002Scenario> {
  const explainRow = (await db.query(`EXPLAIN ${sql}`)).rows[0] ?? {};

  for (let i = 0; i < warmupRounds; i += 1) {
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
  for (let i = 0; i < measuredRounds; i += 1) {
    const queryStarted = performance.now();
    const result = await db.query(sql);
    const elapsed = performance.now() - queryStarted;
    latenciesMs.push(elapsed);

    if (expectedResultRows < 0) expectedResultRows = result.rows.length;
    else if (result.rows.length !== expectedResultRows) {
      throw new Error(
        `${instabilityTag} result-size instability: expected=${expectedResultRows} actual=${result.rows.length} round=${i + 1}`,
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

  return {
    explain: {
      physicalOptimizerAccessPath: String(explainRow.physicalOptimizerAccessPath ?? ""),
      physicalOptimizerIndexStrategy: String(explainRow.physicalOptimizerIndexStrategy ?? ""),
      physicalOptimizerCost: toFixed(toFiniteNumber(explainRow.physicalOptimizerCost)),
      physicalAccessPath: String(explainRow.physicalAccessPath ?? ""),
      physicalIndexStrategy: String(explainRow.physicalIndexStrategy ?? ""),
      physicalCost: toFixed(toFiniteNumber(explainRow.physicalCost)),
      physicalCandidates: String(explainRow.physicalCandidates ?? ""),
    },
    performance: {
      queryCount: measuredRounds,
      totalDurationMs: toFixed(totalDurationMs),
      throughputQps: toQps(measuredRounds, totalDurationMs),
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
      rowsVisitedPerQuery: toFixed(rowsVisitedDelta / Math.max(1, measuredRounds)),
      lastRowsVisited: afterStats?.lastRowsVisited ?? 0,
      pipelinedExecutions: Math.max(0, pipelinedAfter - pipelinedBefore),
      materializedExecutions: Math.max(0, materializedAfter - materializedBefore),
    },
    observability: summarizeIndexObservability(db, BENCH2_TABLE),
  };
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

export async function runP3Bench002IndexedSameLoadBenefit(
  config?: Partial<P3Bench002IndexedConfig>,
): Promise<P3Bench002IndexedReport> {
  const customers = Math.max(400, config?.customers ?? defaultP3Bench002Config.customers);
  const ordersPerCustomer = Math.max(6, config?.ordersPerCustomer ?? defaultP3Bench002Config.ordersPerCustomer);
  const paidEveryNOrders = Math.max(3, config?.paidEveryNOrders ?? defaultP3Bench002Config.paidEveryNOrders);
  const warmupRounds = Math.max(1, config?.warmupRounds ?? defaultP3Bench002Config.warmupRounds);
  const measuredRounds = Math.max(8, config?.measuredRounds ?? defaultP3Bench002Config.measuredRounds);
  const startCandidate = Math.floor(config?.customerRangeStart ?? defaultP3Bench002Config.customerRangeStart);
  const endCandidate = Math.floor(config?.customerRangeEnd ?? defaultP3Bench002Config.customerRangeEnd);
  const customerRangeStart = Math.max(1, Math.min(customers - 1, startCandidate));
  const customerRangeEnd = Math.max(customerRangeStart + 1, Math.min(customers, endCandidate));

  const c: P3Bench002IndexedConfig = {
    customers,
    ordersPerCustomer,
    paidEveryNOrders,
    customerRangeStart,
    customerRangeEnd,
    warmupRounds,
    measuredRounds,
  };

  const db = mkClient();
  await db.execute(`CREATE TABLE ${BENCH2_TABLE} (id INT, customer_id INT, amount INT, status TEXT)`);

  const orderRows = new Array<Record<string, number | string | null>>(c.customers * c.ordersPerCustomer);
  const nonPaidStatuses = ["draft", "shipped", "cancelled", "pending"] as const;

  let paidOrders = 0;
  let orderId = 1;
  for (let customerId = 1; customerId <= c.customers; customerId += 1) {
    for (let i = 0; i < c.ordersPerCustomer; i += 1) {
      const amount = 15 + ((orderId * 13 + customerId * 17 + i * 7) % 500);
      const status =
        orderId % c.paidEveryNOrders === 0
          ? "paid"
          : (nonPaidStatuses[(orderId + customerId + i) % nonPaidStatuses.length] ?? "draft");
      if (status === "paid") paidOrders += 1;

      orderRows[orderId - 1] = {
        id: orderId,
        customer_id: customerId,
        amount,
        status,
      };
      orderId += 1;
    }
  }
  (db as unknown as InternalTableStore).tables.set(BENCH2_TABLE, orderRows);

  const sql =
    "SELECT customer_id, SUM(amount) " +
    `FROM ${BENCH2_TABLE} ` +
    `WHERE status = 'paid' AND customer_id >= ${c.customerRangeStart} AND customer_id <= ${c.customerRangeEnd} ` +
    "GROUP BY customer_id " +
    "ORDER BY sum DESC, customer_id ASC LIMIT 80";

  const baseline = await runBench002Scenario(db, sql, c.warmupRounds, c.measuredRounds, "P3-BENCH-002 baseline");

  const createdIndexes = ["idx_p3_bench2_orders_status", "idx_p3_bench2_orders_customer_id"];
  const indexBuildStarted = performance.now();
  await db.execute(`CREATE INDEX ${createdIndexes[0]} ON ${BENCH2_TABLE}(status)`);
  await db.execute(`CREATE INDEX ${createdIndexes[1]} ON ${BENCH2_TABLE}(customer_id)`);
  const indexBuildMs = performance.now() - indexBuildStarted;

  const indexed = await runBench002Scenario(db, sql, c.warmupRounds, c.measuredRounds, "P3-BENCH-002 indexed");

  if (baseline.execution.resultRows !== indexed.execution.resultRows) {
    throw new Error(
      `P3-BENCH-002 result-size mismatch: baseline=${baseline.execution.resultRows} indexed=${indexed.execution.resultRows}`,
    );
  }

  const throughputQpsDelta = toFixed(indexed.performance.throughputQps - baseline.performance.throughputQps);
  const throughputQpsGainPct =
    baseline.performance.throughputQps > 0
      ? toFixed((throughputQpsDelta / baseline.performance.throughputQps) * 100)
      : 0;
  const p95LatencyMsDelta = toFixed(baseline.performance.p95LatencyMs - indexed.performance.p95LatencyMs);
  const p95LatencyReductionPct =
    baseline.performance.p95LatencyMs > 0
      ? toFixed((p95LatencyMsDelta / baseline.performance.p95LatencyMs) * 100)
      : 0;
  const rowsVisitedPerQueryDelta = toFixed(baseline.execution.rowsVisitedPerQuery - indexed.execution.rowsVisitedPerQuery);
  const rowsVisitedReductionPct =
    baseline.execution.rowsVisitedPerQuery > 0
      ? toFixed((rowsVisitedPerQueryDelta / baseline.execution.rowsVisitedPerQuery) * 100)
      : 0;
  const physicalCostDelta = toFixed(baseline.explain.physicalCost - indexed.explain.physicalCost);
  const physicalCostReductionPct =
    baseline.explain.physicalCost > 0
      ? toFixed((physicalCostDelta / baseline.explain.physicalCost) * 100)
      : 0;

  return {
    benchmark: "p3-bench-002-indexed-same-load-benefit",
    at: new Date().toISOString(),
    config: c,
    dataset: {
      customers: c.customers,
      orders: orderRows.length,
      paidOrders,
    },
    query: {
      sql,
      warmupRounds: c.warmupRounds,
      measuredRounds: c.measuredRounds,
    },
    baseline,
    indexed: {
      ...indexed,
      indexBuildMs: toFixed(indexBuildMs),
      createdIndexes,
    },
    gains: {
      throughputQpsDelta,
      throughputQpsGainPct,
      p95LatencyMsDelta,
      p95LatencyReductionPct,
      rowsVisitedPerQueryDelta,
      rowsVisitedReductionPct,
      physicalCostDelta,
      physicalCostReductionPct,
    },
  };
}

export async function writeP3BenchReport(path: string, report: P3BenchReport): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
