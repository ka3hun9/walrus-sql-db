import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "../../src/client.js";

type InternalTableStore = {
  tables: Map<string, Array<Record<string, number | string | null>>>;
};

type InternalSelectPlanStabilityState = {
  preferredMethod: "TABLE_SCAN" | "HASH_INDEX_LOOKUP" | "BTREE_INDEX_LOOKUP" | "BTREE_ORDERED_SCAN";
  preferredIndexName?: string;
  preferredIndexColumn?: string;
  badPlanFallbackRemaining: number;
  badPlanFallbackCount: number;
  stablePinCount: number;
  planSwitchCount: number;
  executions: number;
  lastReason: string;
};

type InternalSelectPlanStabilityStore = {
  selectPlanStability: Map<string, InternalSelectPlanStabilityState>;
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

export interface P3Bench003CboBenefitConfig {
  rows: number;
  scoreModulo: number;
  scoreWindowStart: number;
  scoreWindowWidth: number;
  warmupRounds: number;
  measuredRounds: number;
}

type P3Bench003Explain = P3Bench002Explain & {
  physicalStabilityReason: string;
};

type P3Bench003Scenario = {
  explain: P3Bench003Explain;
  performance: P3Bench002Performance;
  execution: P3Bench002Execution;
  observability: P3Bench002Observability;
};

export interface P3Bench003CboBenefitReport {
  benchmark: "p3-bench-003-cbo-benefit-vs-fixed-rule-baseline";
  at: string;
  config: P3Bench003CboBenefitConfig;
  dataset: {
    rows: number;
    distinctScores: number;
    indexedColumn: string;
    indexName: string;
  };
  query: {
    sql: string;
    warmupRounds: number;
    measuredRounds: number;
    fixedRulePolicy: string;
  };
  fixedRuleBaseline: P3Bench003Scenario;
  cbo: P3Bench003Scenario;
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
  verdict: {
    cboPreferred: boolean;
    reasons: string[];
  };
}

export interface P3Bench004LargeDatasetConfig {
  customers: number;
  ordersPerCustomer: number;
  shipmentDeliveredEveryNOrders: number;
  refundEveryNOrders: number;
  warmupRounds: number;
  measuredRounds: number;
  joinMemoryBudgetRows: number;
  joinSpillChunkRows: number;
}

type P3Bench004Explain = P3Bench002Explain & {
  physicalJoinCount: number;
  physicalJoinAlgorithms: string;
  physicalJoinPlan: string;
};

type P3Bench004Execution = P3Bench002Execution & {
  earlyStopExecutions: number;
  joinSpillExecutions: number;
  joinSpillChunks: number;
  joinSpillRowsProcessed: number;
};

type P3Bench004SubqueryEvidence = {
  entries: number;
  executions: number;
  correlatedExecutions: number;
  cacheHits: number;
  cacheMisses: number;
  rowsScanned: number;
  rowsReturned: number;
  budgetExceededCount: number;
};

type P3Bench004Scenario = {
  explain: P3Bench004Explain;
  performance: P3Bench002Performance;
  execution: P3Bench004Execution;
  observability: P3Bench002Observability;
  subquery?: P3Bench004SubqueryEvidence;
};

export interface P3Bench004LargeDatasetReport {
  benchmark: "p3-bench-004-large-dataset-complex-join-subquery-stress";
  at: string;
  config: P3Bench004LargeDatasetConfig;
  dataset: {
    customers: number;
    orders: number;
    shipments: number;
    refunds: number;
    paidOrders: number;
    shippedOrders: number;
  };
  query: {
    joinSql: string;
    subquerySql: string;
    warmupRounds: number;
    measuredRounds: number;
    subqueryFragments: {
      inSubquery: string;
      existsSubquery: string;
      scalarSubquery: string;
    };
  };
  joinStress: P3Bench004Scenario;
  subqueryStress: P3Bench004Scenario;
  verdict: {
    largeDataset: boolean;
    complexJoinObserved: boolean;
    complexSubqueryObserved: boolean;
    stableResultRows: boolean;
    reasons: string[];
  };
}

export type P3BenchReport =
  | P3Bench001NoIndexReport
  | P3Bench002IndexedReport
  | P3Bench003CboBenefitReport
  | P3Bench004LargeDatasetReport;

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

const defaultP3Bench003Config: P3Bench003CboBenefitConfig = {
  rows: 24000,
  scoreModulo: 5000,
  scoreWindowStart: 1900,
  scoreWindowWidth: 2,
  warmupRounds: 3,
  measuredRounds: 16,
};

const defaultP3Bench004Config: P3Bench004LargeDatasetConfig = {
  customers: 2600,
  ordersPerCustomer: 18,
  shipmentDeliveredEveryNOrders: 2,
  refundEveryNOrders: 6,
  warmupRounds: 2,
  measuredRounds: 10,
  joinMemoryBudgetRows: 250000,
  joinSpillChunkRows: 4096,
};

const BENCH_TABLES = {
  customers: "p3_bench1_customers",
  orders: "p3_bench1_orders",
  refunds: "p3_bench1_refunds",
} as const;

const BENCH2_TABLE = "p3_bench2_orders";
const BENCH3_TABLE = "p3_bench3_metrics";
const BENCH3_INDEX = "idx_p3_bench3_score";
const BENCH3_FIXED_RULE_POLICY = "ALWAYS_TABLE_SCAN";
const BENCH4_TABLES = {
  customers: "p3_bench4_customers",
  orders: "p3_bench4_orders",
  shipments: "p3_bench4_shipments",
  refunds: "p3_bench4_refunds",
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

function toFiniteNumber(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function normalizeSqlKey(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

function applyFixedRuleTableScan(db: WalrusSqlClient, sql: string, rounds: number): void {
  const key = normalizeSqlKey(sql);
  const stability = (db as unknown as InternalSelectPlanStabilityStore).selectPlanStability;
  stability.set(key, {
    preferredMethod: "TABLE_SCAN",
    preferredIndexName: undefined,
    preferredIndexColumn: undefined,
    badPlanFallbackRemaining: Math.max(1, rounds),
    badPlanFallbackCount: 1,
    stablePinCount: 0,
    planSwitchCount: 0,
    executions: 0,
    lastReason: "BAD_PLAN_FALLBACK_PIN",
  });
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

type SubqueryStatSnapshot = {
  executions: number;
  correlatedExecutions: number;
  cacheHits: number;
  cacheMisses: number;
  rowsScanned: number;
  rowsReturned: number;
  budgetExceededCount: number;
};

function readSubquerySnapshot(db: WalrusSqlClient, subquerySql: string): SubqueryStatSnapshot {
  const row = db.getSubqueryExecutionStats(subquerySql)[0];
  return {
    executions: row?.executions ?? 0,
    correlatedExecutions: row?.correlatedExecutions ?? 0,
    cacheHits: row?.cacheHits ?? 0,
    cacheMisses: row?.cacheMisses ?? 0,
    rowsScanned: row?.rowsScanned ?? 0,
    rowsReturned: row?.rowsReturned ?? 0,
    budgetExceededCount: row?.budgetExceededCount ?? 0,
  };
}

function diffSubquerySnapshot(after: SubqueryStatSnapshot, before: SubqueryStatSnapshot): SubqueryStatSnapshot {
  return {
    executions: Math.max(0, after.executions - before.executions),
    correlatedExecutions: Math.max(0, after.correlatedExecutions - before.correlatedExecutions),
    cacheHits: Math.max(0, after.cacheHits - before.cacheHits),
    cacheMisses: Math.max(0, after.cacheMisses - before.cacheMisses),
    rowsScanned: Math.max(0, after.rowsScanned - before.rowsScanned),
    rowsReturned: Math.max(0, after.rowsReturned - before.rowsReturned),
    budgetExceededCount: Math.max(0, after.budgetExceededCount - before.budgetExceededCount),
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

async function runBench003Scenario(
  db: WalrusSqlClient,
  sql: string,
  warmupRounds: number,
  measuredRounds: number,
  instabilityTag: string,
): Promise<P3Bench003Scenario> {
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
      physicalStabilityReason: String(explainRow.physicalStabilityReason ?? ""),
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
    observability: summarizeIndexObservability(db, BENCH3_TABLE),
  };
}

async function runBench004Scenario(
  db: WalrusSqlClient,
  sql: string,
  warmupRounds: number,
  measuredRounds: number,
  instabilityTag: string,
  trackedSubqueries: string[] = [],
): Promise<P3Bench004Scenario> {
  const explainRow = (await db.query(`EXPLAIN ${sql}`)).rows[0] ?? {};
  const subqueryBefore = trackedSubqueries.map((subquerySql) => readSubquerySnapshot(db, subquerySql));

  for (let i = 0; i < warmupRounds; i += 1) {
    await db.query(sql);
  }

  const warmedStats = db.getSelectExecutionPipelineStats(sql)[0];
  const rowsVisitedBefore = warmedStats?.rowsVisited ?? 0;
  const pipelinedBefore = warmedStats?.pipelinedExecutions ?? 0;
  const materializedBefore = warmedStats?.materializedExecutions ?? 0;
  const earlyStopBefore = warmedStats?.earlyStopExecutions ?? 0;
  const spillExecutionsBefore = warmedStats?.joinSpillExecutions ?? 0;
  const spillChunksBefore = warmedStats?.joinSpillChunks ?? 0;
  const spillRowsProcessedBefore = warmedStats?.joinSpillRowsProcessed ?? 0;

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
  const earlyStopAfter = afterStats?.earlyStopExecutions ?? 0;
  const spillExecutionsAfter = afterStats?.joinSpillExecutions ?? 0;
  const spillChunksAfter = afterStats?.joinSpillChunks ?? 0;
  const spillRowsProcessedAfter = afterStats?.joinSpillRowsProcessed ?? 0;
  const rowsVisitedDelta = Math.max(0, rowsVisitedAfter - rowsVisitedBefore);

  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const avgLatencyMs = latenciesMs.reduce((sum, value) => sum + value, 0) / Math.max(1, latenciesMs.length);
  const minLatencyMs = sortedLatencies[0] ?? 0;
  const maxLatencyMs = sortedLatencies[sortedLatencies.length - 1] ?? 0;
  const p50LatencyMs = toLatencyPercentile(sortedLatencies, 50);
  const p95LatencyMs = toLatencyPercentile(sortedLatencies, 95);
  const p99LatencyMs = toLatencyPercentile(sortedLatencies, 99);

  let subquery: P3Bench004SubqueryEvidence | undefined;
  if (trackedSubqueries.length > 0) {
    const subqueryAfter = trackedSubqueries.map((subquerySql) => readSubquerySnapshot(db, subquerySql));
    const delta = subqueryAfter.map((after, idx) => diffSubquerySnapshot(after, subqueryBefore[idx]!));
    subquery = {
      entries: trackedSubqueries.length,
      executions: delta.reduce((sum, row) => sum + row.executions, 0),
      correlatedExecutions: delta.reduce((sum, row) => sum + row.correlatedExecutions, 0),
      cacheHits: delta.reduce((sum, row) => sum + row.cacheHits, 0),
      cacheMisses: delta.reduce((sum, row) => sum + row.cacheMisses, 0),
      rowsScanned: delta.reduce((sum, row) => sum + row.rowsScanned, 0),
      rowsReturned: delta.reduce((sum, row) => sum + row.rowsReturned, 0),
      budgetExceededCount: delta.reduce((sum, row) => sum + row.budgetExceededCount, 0),
    };
  }

  return {
    explain: {
      physicalOptimizerAccessPath: String(explainRow.physicalOptimizerAccessPath ?? ""),
      physicalOptimizerIndexStrategy: String(explainRow.physicalOptimizerIndexStrategy ?? ""),
      physicalOptimizerCost: toFixed(toFiniteNumber(explainRow.physicalOptimizerCost)),
      physicalAccessPath: String(explainRow.physicalAccessPath ?? ""),
      physicalIndexStrategy: String(explainRow.physicalIndexStrategy ?? ""),
      physicalCost: toFixed(toFiniteNumber(explainRow.physicalCost)),
      physicalCandidates: String(explainRow.physicalCandidates ?? ""),
      physicalJoinCount: Math.max(0, Math.floor(toFiniteNumber(explainRow.physicalJoinCount))),
      physicalJoinAlgorithms: String(explainRow.physicalJoinAlgorithms ?? ""),
      physicalJoinPlan: String(explainRow.physicalJoinPlan ?? ""),
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
      earlyStopExecutions: Math.max(0, earlyStopAfter - earlyStopBefore),
      joinSpillExecutions: Math.max(0, spillExecutionsAfter - spillExecutionsBefore),
      joinSpillChunks: Math.max(0, spillChunksAfter - spillChunksBefore),
      joinSpillRowsProcessed: Math.max(0, spillRowsProcessedAfter - spillRowsProcessedBefore),
    },
    observability: summarizeIndexObservability(db),
    subquery,
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

export async function runP3Bench003CboBenefitVsFixedRuleBaseline(
  config?: Partial<P3Bench003CboBenefitConfig>,
): Promise<P3Bench003CboBenefitReport> {
  const rows = Math.max(5000, Math.floor(config?.rows ?? defaultP3Bench003Config.rows));
  const scoreModulo = Math.max(200, Math.floor(config?.scoreModulo ?? defaultP3Bench003Config.scoreModulo));
  const warmupRounds = Math.max(1, Math.floor(config?.warmupRounds ?? defaultP3Bench003Config.warmupRounds));
  const measuredRounds = Math.max(10, Math.floor(config?.measuredRounds ?? defaultP3Bench003Config.measuredRounds));
  const startCandidate = Math.floor(config?.scoreWindowStart ?? defaultP3Bench003Config.scoreWindowStart);
  const scoreWindowStart = Math.max(0, Math.min(scoreModulo - 2, startCandidate));
  const maxWindowWidth = Math.max(1, scoreModulo - scoreWindowStart);
  const widthCandidate = Math.floor(config?.scoreWindowWidth ?? defaultP3Bench003Config.scoreWindowWidth);
  const minWindowWidth = Math.min(1, maxWindowWidth);
  const scoreWindowWidth = Math.max(minWindowWidth, Math.min(maxWindowWidth, widthCandidate));
  const scoreWindowEnd = scoreWindowStart + scoreWindowWidth;

  const c: P3Bench003CboBenefitConfig = {
    rows,
    scoreModulo,
    scoreWindowStart,
    scoreWindowWidth,
    warmupRounds,
    measuredRounds,
  };

  const tableRows = new Array<Record<string, number | string | null>>(c.rows);
  const distinctScores = new Set<number>();
  for (let id = 1; id <= c.rows; id += 1) {
    const score = (id * 37) % c.scoreModulo;
    distinctScores.add(score);
    tableRows[id - 1] = {
      id,
      score,
      payload: `p${id % 97}`,
    };
  }

  const sql =
    `SELECT score FROM ${BENCH3_TABLE} ` +
    `WHERE score >= ${scoreWindowStart} AND score < ${scoreWindowEnd} ` +
    "ORDER BY score ASC LIMIT 120";

  const setupBench003Client = async (): Promise<WalrusSqlClient> => {
    const db = mkClient();
    await db.execute(`CREATE TABLE ${BENCH3_TABLE} (id INT, score INT, payload TEXT)`);
    (db as unknown as InternalTableStore).tables.set(
      BENCH3_TABLE,
      tableRows.map((row) => ({ ...row })),
    );
    await db.execute(`CREATE INDEX ${BENCH3_INDEX} ON ${BENCH3_TABLE}(score)`);
    return db;
  };

  const fixedRuleDb = await setupBench003Client();
  const cboDb = await setupBench003Client();

  applyFixedRuleTableScan(fixedRuleDb, sql, c.warmupRounds + c.measuredRounds + 8);

  const fixedRuleBaseline = await runBench003Scenario(
    fixedRuleDb,
    sql,
    c.warmupRounds,
    c.measuredRounds,
    "P3-BENCH-003 fixed-rule",
  );
  const cbo = await runBench003Scenario(
    cboDb,
    sql,
    c.warmupRounds,
    c.measuredRounds,
    "P3-BENCH-003 cbo",
  );

  if (fixedRuleBaseline.execution.resultRows !== cbo.execution.resultRows) {
    throw new Error(
      `P3-BENCH-003 result-size mismatch: fixedRule=${fixedRuleBaseline.execution.resultRows} cbo=${cbo.execution.resultRows}`,
    );
  }

  const throughputQpsDelta = toFixed(cbo.performance.throughputQps - fixedRuleBaseline.performance.throughputQps);
  const throughputQpsGainPct =
    fixedRuleBaseline.performance.throughputQps > 0
      ? toFixed((throughputQpsDelta / fixedRuleBaseline.performance.throughputQps) * 100)
      : 0;
  const p95LatencyMsDelta = toFixed(fixedRuleBaseline.performance.p95LatencyMs - cbo.performance.p95LatencyMs);
  const p95LatencyReductionPct =
    fixedRuleBaseline.performance.p95LatencyMs > 0
      ? toFixed((p95LatencyMsDelta / fixedRuleBaseline.performance.p95LatencyMs) * 100)
      : 0;
  const rowsVisitedPerQueryDelta = toFixed(
    fixedRuleBaseline.execution.rowsVisitedPerQuery - cbo.execution.rowsVisitedPerQuery,
  );
  const rowsVisitedReductionPct =
    fixedRuleBaseline.execution.rowsVisitedPerQuery > 0
      ? toFixed((rowsVisitedPerQueryDelta / fixedRuleBaseline.execution.rowsVisitedPerQuery) * 100)
      : 0;
  const physicalCostDelta = toFixed(fixedRuleBaseline.explain.physicalCost - cbo.explain.physicalCost);
  const physicalCostReductionPct =
    fixedRuleBaseline.explain.physicalCost > 0
      ? toFixed((physicalCostDelta / fixedRuleBaseline.explain.physicalCost) * 100)
      : 0;

  const reasons: string[] = [];
  if (fixedRuleBaseline.explain.physicalAccessPath === "TABLE_SCAN") {
    reasons.push("fixed-rule baseline used TABLE_SCAN");
  }
  if (cbo.explain.physicalAccessPath !== "TABLE_SCAN") {
    reasons.push(`CBO selected ${cbo.explain.physicalAccessPath}`);
  }
  if (rowsVisitedPerQueryDelta > 0) {
    reasons.push(`rowsVisited/query reduced by ${rowsVisitedPerQueryDelta}`);
  }
  if (physicalCostDelta > 0) {
    reasons.push(`physical cost reduced by ${physicalCostDelta}`);
  }

  const cboPreferred =
    fixedRuleBaseline.explain.physicalAccessPath === "TABLE_SCAN"
    && cbo.explain.physicalAccessPath !== "TABLE_SCAN"
    && rowsVisitedPerQueryDelta > 0
    && physicalCostDelta > 0;

  return {
    benchmark: "p3-bench-003-cbo-benefit-vs-fixed-rule-baseline",
    at: new Date().toISOString(),
    config: c,
    dataset: {
      rows: tableRows.length,
      distinctScores: distinctScores.size,
      indexedColumn: "score",
      indexName: BENCH3_INDEX,
    },
    query: {
      sql,
      warmupRounds: c.warmupRounds,
      measuredRounds: c.measuredRounds,
      fixedRulePolicy: BENCH3_FIXED_RULE_POLICY,
    },
    fixedRuleBaseline,
    cbo,
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
    verdict: {
      cboPreferred,
      reasons,
    },
  };
}

export async function runP3Bench004LargeDatasetComplexJoinSubqueryStress(
  config?: Partial<P3Bench004LargeDatasetConfig>,
): Promise<P3Bench004LargeDatasetReport> {
  const customers = Math.max(1000, Math.floor(config?.customers ?? defaultP3Bench004Config.customers));
  const ordersPerCustomer = Math.max(8, Math.floor(config?.ordersPerCustomer ?? defaultP3Bench004Config.ordersPerCustomer));
  const shipmentDeliveredEveryNOrders = Math.max(
    2,
    Math.floor(config?.shipmentDeliveredEveryNOrders ?? defaultP3Bench004Config.shipmentDeliveredEveryNOrders),
  );
  const refundEveryNOrders = Math.max(3, Math.floor(config?.refundEveryNOrders ?? defaultP3Bench004Config.refundEveryNOrders));
  const warmupRounds = Math.max(1, Math.floor(config?.warmupRounds ?? defaultP3Bench004Config.warmupRounds));
  const measuredRounds = Math.max(6, Math.floor(config?.measuredRounds ?? defaultP3Bench004Config.measuredRounds));
  const joinMemoryBudgetRows = Math.max(
    4096,
    Math.floor(config?.joinMemoryBudgetRows ?? defaultP3Bench004Config.joinMemoryBudgetRows),
  );
  const spillChunkCandidate = Math.floor(config?.joinSpillChunkRows ?? defaultP3Bench004Config.joinSpillChunkRows);
  const joinSpillChunkRows = Math.max(1, Math.min(joinMemoryBudgetRows, spillChunkCandidate));

  const c: P3Bench004LargeDatasetConfig = {
    customers,
    ordersPerCustomer,
    shipmentDeliveredEveryNOrders,
    refundEveryNOrders,
    warmupRounds,
    measuredRounds,
    joinMemoryBudgetRows,
    joinSpillChunkRows,
  };

  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
    joinExecution: {
      memoryBudgetRows: c.joinMemoryBudgetRows,
      spillChunkRows: c.joinSpillChunkRows,
    },
  });

  await db.execute(
    `CREATE TABLE ${BENCH4_TABLES.customers} (customer_id INT, customer_tier INT, customer_region TEXT)`,
  );
  await db.execute(
    `CREATE TABLE ${BENCH4_TABLES.orders} (order_id INT, customer_id INT, order_amount INT, order_status TEXT)`,
  );
  await db.execute(
    `CREATE TABLE ${BENCH4_TABLES.shipments} (shipment_id INT, order_id INT, delivered_flag INT)`,
  );
  await db.execute(
    `CREATE TABLE ${BENCH4_TABLES.refunds} (refund_id INT, order_id INT, refund_amount INT)`,
  );

  const totalOrders = c.customers * c.ordersPerCustomer;
  const customerRows = new Array<Record<string, number | string | null>>(c.customers);
  const orderRows = new Array<Record<string, number | string | null>>(totalOrders);
  const shipmentRows = new Array<Record<string, number | string | null>>(totalOrders);
  const refundRows: Array<Record<string, number | string | null>> = [];

  const regions = ["APAC", "EU", "LATAM", "MEA", "NA"] as const;
  const nonPaidStatuses = ["draft", "pending", "cancelled"] as const;

  let paidOrders = 0;
  let shippedOrders = 0;
  let orderId = 1;
  let refundId = 1;
  for (let customerId = 1; customerId <= c.customers; customerId += 1) {
    customerRows[customerId - 1] = {
      customer_id: customerId,
      customer_tier: (customerId % 6) + 1,
      customer_region: regions[customerId % regions.length] ?? "NA",
    };

    for (let i = 0; i < c.ordersPerCustomer; i += 1) {
      const amount = 35 + ((customerId * 19 + i * 23 + orderId * 7) % 960);
      const status =
        orderId % 6 === 0
          ? "paid"
          : orderId % 5 === 0
            ? "shipped"
            : orderId % 11 === 0
              ? "refunded"
              : (nonPaidStatuses[(orderId + customerId + i) % nonPaidStatuses.length] ?? "draft");

      if (status === "paid") paidOrders += 1;
      if (status === "shipped") shippedOrders += 1;

      orderRows[orderId - 1] = {
        order_id: orderId,
        customer_id: customerId,
        order_amount: amount,
        order_status: status,
      };
      shipmentRows[orderId - 1] = {
        shipment_id: orderId,
        order_id: orderId,
        delivered_flag: orderId % c.shipmentDeliveredEveryNOrders === 0 ? 1 : 0,
      };

      if (orderId % c.refundEveryNOrders === 0) {
        refundRows.push({
          refund_id: refundId,
          order_id: orderId,
          refund_amount: Math.max(1, Math.floor(amount / 7)),
        });
        refundId += 1;
      }

      orderId += 1;
    }
  }

  (db as unknown as InternalTableStore).tables.set(BENCH4_TABLES.customers, customerRows);
  (db as unknown as InternalTableStore).tables.set(BENCH4_TABLES.orders, orderRows);
  (db as unknown as InternalTableStore).tables.set(BENCH4_TABLES.shipments, shipmentRows);
  (db as unknown as InternalTableStore).tables.set(BENCH4_TABLES.refunds, refundRows);

  await db.execute(`CREATE INDEX idx_p3_bench4_customers_tier ON ${BENCH4_TABLES.customers}(customer_tier)`);
  await db.execute(`CREATE INDEX idx_p3_bench4_orders_customer_id ON ${BENCH4_TABLES.orders}(customer_id)`);
  await db.execute(`CREATE INDEX idx_p3_bench4_orders_status ON ${BENCH4_TABLES.orders}(order_status)`);
  await db.execute(`CREATE INDEX idx_p3_bench4_shipments_order_id ON ${BENCH4_TABLES.shipments}(order_id)`);
  await db.execute(`CREATE INDEX idx_p3_bench4_refunds_order_id ON ${BENCH4_TABLES.refunds}(order_id)`);

  const joinSql =
    "SELECT customer_region, SUM(order_amount) " +
    `FROM ${BENCH4_TABLES.customers} ` +
    `INNER JOIN ${BENCH4_TABLES.orders} ON ${BENCH4_TABLES.customers}.customer_id = ${BENCH4_TABLES.orders}.customer_id ` +
    `INNER JOIN ${BENCH4_TABLES.shipments} ON ${BENCH4_TABLES.orders}.order_id = ${BENCH4_TABLES.shipments}.order_id ` +
    `LEFT JOIN ${BENCH4_TABLES.refunds} ON ${BENCH4_TABLES.orders}.order_id = ${BENCH4_TABLES.refunds}.order_id ` +
    "WHERE customer_tier <= 4 AND order_status IN ('paid','shipped') AND delivered_flag = 1 " +
    "GROUP BY customer_region ORDER BY sum DESC, customer_region ASC LIMIT 8";

  const inSubquery = `SELECT customer_id FROM ${BENCH4_TABLES.orders} WHERE order_status = 'paid'`;
  const existsSubquery =
    `SELECT 1 FROM ${BENCH4_TABLES.customers} ` +
    `WHERE ${BENCH4_TABLES.customers}.customer_region = outer.customer_region AND customer_tier >= 4`;
  const scalarSubquery =
    `SELECT MAX(customer_id) FROM ${BENCH4_TABLES.customers} ` +
    `WHERE ${BENCH4_TABLES.customers}.customer_region = outer.customer_region`;
  const subquerySql =
    "SELECT customer_id " +
    `FROM ${BENCH4_TABLES.customers} ` +
    "WHERE customer_tier <= 4 AND customer_id <= 80 " +
    `AND customer_id IN (${inSubquery}) ` +
    `AND EXISTS (${existsSubquery}) ` +
    `AND customer_id < (${scalarSubquery}) ` +
    "ORDER BY customer_id ASC LIMIT 150";

  const joinStress = await runBench004Scenario(
    db,
    joinSql,
    c.warmupRounds,
    c.measuredRounds,
    "P3-BENCH-004 join",
  );
  const subqueryStress = await runBench004Scenario(
    db,
    subquerySql,
    c.warmupRounds,
    c.measuredRounds,
    "P3-BENCH-004 subquery",
    [inSubquery, existsSubquery, scalarSubquery],
  );

  if (joinStress.execution.resultRows <= 0) {
    throw new Error("P3-BENCH-004 join workload returned no rows");
  }
  if (subqueryStress.execution.resultRows <= 0) {
    throw new Error("P3-BENCH-004 subquery workload returned no rows");
  }

  const largeDataset = orderRows.length >= 20_000;
  const complexJoinObserved =
    joinStress.explain.physicalJoinCount >= 2 && joinStress.explain.physicalJoinAlgorithms.length > 0;
  const complexSubqueryObserved =
    (subqueryStress.subquery?.executions ?? 0) >= c.measuredRounds
    && (subqueryStress.subquery?.correlatedExecutions ?? 0) > 0;
  const stableResultRows = joinStress.execution.resultRows > 0 && subqueryStress.execution.resultRows > 0;

  const reasons: string[] = [];
  if (largeDataset) reasons.push(`large dataset rows=${orderRows.length}`);
  if (complexJoinObserved) reasons.push(`join plan=${joinStress.explain.physicalJoinAlgorithms}`);
  if (complexSubqueryObserved) {
    reasons.push(
      `subquery executions=${subqueryStress.subquery?.executions ?? 0}, correlated=${subqueryStress.subquery?.correlatedExecutions ?? 0}`,
    );
  }
  if (joinStress.execution.rowsVisited > 0 && subqueryStress.execution.rowsVisited > 0) {
    reasons.push("both workloads captured non-zero rowsVisited");
  }

  return {
    benchmark: "p3-bench-004-large-dataset-complex-join-subquery-stress",
    at: new Date().toISOString(),
    config: c,
    dataset: {
      customers: customerRows.length,
      orders: orderRows.length,
      shipments: shipmentRows.length,
      refunds: refundRows.length,
      paidOrders,
      shippedOrders,
    },
    query: {
      joinSql,
      subquerySql,
      warmupRounds: c.warmupRounds,
      measuredRounds: c.measuredRounds,
      subqueryFragments: {
        inSubquery,
        existsSubquery,
        scalarSubquery,
      },
    },
    joinStress,
    subqueryStress,
    verdict: {
      largeDataset,
      complexJoinObserved,
      complexSubqueryObserved,
      stableResultRows,
      reasons,
    },
  };
}

export async function writeP3BenchReport(path: string, report: P3BenchReport): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
