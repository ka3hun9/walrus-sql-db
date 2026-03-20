import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { WalrusSqlClient } from "../src/client.js";

type InternalTableStore = {
  tables: Map<string, Array<Record<string, number>>>;
};

const TABLE = "p3_test8_events";
const VIEW = "p3_test8_high_score";
const CUSTOMER_INDEX = "idx_p3_test8_customer";
const PROBE_TABLE = "p3_test8_probe";

const INITIAL_ROWS = 20_000;
const CUSTOMER_BUCKETS = 255;
const TARGET_CUSTOMER = 77;
const TARGET_REGION = 1;
const HIGH_SCORE_FLOOR = 900;

const LONG_RUN_DURATION_MS = 3_500;
const WRITE_INTERVAL_MS = 5;
const MIN_WRITES = 20;
const MIN_WINDOW_SIZE = 6;
const PERF_DEGRADATION_RATIO_THRESHOLD = 2.5;
const MIN_WRITES_PER_SEC_THRESHOLD = 0.5;

const VIEW_CHECK_INTERVAL = 8;
const REGION_CHECK_INTERVAL = 12;
const GLOBAL_COUNT_CHECK_INTERVAL = 25;

const TARGET_ROWS_SQL = `SELECT id FROM ${TABLE} WHERE customer_id = ${TARGET_CUSTOMER}`;
const VIEW_COUNT_SQL = `SELECT COUNT(*) FROM ${VIEW} WHERE customer_id = ${TARGET_CUSTOMER}`;
const TARGET_REGION_COUNT_SQL = `SELECT COUNT(*) FROM ${TABLE} WHERE customer_id = ${TARGET_CUSTOMER} AND region = ${TARGET_REGION}`;
const CORRELATED_EXISTS_SUBQUERY_SQL = `SELECT 1 FROM ${PROBE_TABLE} WHERE ${PROBE_TABLE}.id = outer.id AND flag = 1`;
const CORRELATED_EXISTS_PROBE_SQL = `SELECT COUNT(*) FROM ${PROBE_TABLE} WHERE EXISTS (${CORRELATED_EXISTS_SUBQUERY_SQL})`;

function toEventRow(id: number): Record<string, number> {
  return {
    id,
    customer_id: id % CUSTOMER_BUCKETS,
    score: (id * 37) % 1000,
    region: id % 4,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function readCount(rows: Array<Record<string, unknown>>): number {
  return Number(rows[0]?.count ?? -1);
}

const rows: Array<Record<string, number>> = new Array(INITIAL_ROWS);
let expectedTotalRows = 0;
let expectedTargetRows = 0;
let expectedTargetHighScoreRows = 0;
let expectedTargetRegionRows = 0;

for (let i = 0; i < INITIAL_ROWS; i += 1) {
  const row = toEventRow(i + 1);
  rows[i] = row;
  expectedTotalRows += 1;
  if (row.customer_id !== TARGET_CUSTOMER) continue;
  expectedTargetRows += 1;
  if (row.score >= HIGH_SCORE_FLOOR) expectedTargetHighScoreRows += 1;
  if (row.region === TARGET_REGION) expectedTargetRegionRows += 1;
}

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute(`CREATE TABLE ${TABLE} (id INT PRIMARY KEY, customer_id INT, score INT, region INT)`);
(db as unknown as InternalTableStore).tables.set(TABLE, rows);
await db.execute(`CREATE INDEX ${CUSTOMER_INDEX} ON ${TABLE}(customer_id)`);
await db.execute(`CREATE VIEW ${VIEW} AS SELECT id, customer_id, score, region FROM ${TABLE} WHERE score >= ${HIGH_SCORE_FLOOR}`);
await db.execute(`CREATE TABLE ${PROBE_TABLE} (id INT PRIMARY KEY, bucket INT, flag INT)`);
const probeRows: Array<Record<string, number>> = new Array(64);
for (let i = 0; i < 64; i += 1) {
  const id = i + 1;
  probeRows[i] = {
    id,
    bucket: id % 7,
    flag: id % 4 === 1 ? 1 : 0,
  };
}
(db as unknown as InternalTableStore).tables.set(PROBE_TABLE, probeRows);

for (let i = 0; i < 5; i += 1) {
  await db.query(TARGET_ROWS_SQL);
}

const latenciesMs: number[] = [];
let writes = 0;
let consistencyChecks = 0;
let errors = 0;
const startedAt = performance.now();

while (writes < MIN_WRITES || performance.now() - startedAt < LONG_RUN_DURATION_MS) {
  const id = INITIAL_ROWS + writes + 1;
  const row = toEventRow(id);

  try {
    await db.execute("BEGIN");
    await db.execute(
      `INSERT INTO ${TABLE} (id, customer_id, score, region) VALUES (${row.id}, ${row.customer_id}, ${row.score}, ${row.region})`,
    );
    await db.execute("COMMIT");
  } catch {
    errors += 1;
    try {
      await db.execute("ROLLBACK");
    } catch {
      // noop
    }
    continue;
  }

  writes += 1;
  expectedTotalRows += 1;
  if (row.customer_id === TARGET_CUSTOMER) {
    expectedTargetRows += 1;
    if (row.score >= HIGH_SCORE_FLOOR) expectedTargetHighScoreRows += 1;
    if (row.region === TARGET_REGION) expectedTargetRegionRows += 1;
  }

  const queryStarted = performance.now();
  const targetRowsResult = await db.query(TARGET_ROWS_SQL);
  const elapsedMs = performance.now() - queryStarted;
  latenciesMs.push(elapsedMs);
  assert.equal(targetRowsResult.rows.length, expectedTargetRows);

  const pipeline = db.getSelectExecutionPipelineStats(TARGET_ROWS_SQL)[0];
  assert.ok(pipeline);
  assert.ok((pipeline?.lastRowsVisited ?? Number.MAX_SAFE_INTEGER) <= expectedTargetRows);

  if (writes % VIEW_CHECK_INTERVAL === 0) {
    const viewCount = readCount((await db.query(VIEW_COUNT_SQL)).rows);
    assert.equal(viewCount, expectedTargetHighScoreRows);
    consistencyChecks += 1;
  }

  if (writes % REGION_CHECK_INTERVAL === 0) {
    const regionCount = readCount((await db.query(TARGET_REGION_COUNT_SQL)).rows);
    assert.equal(regionCount, expectedTargetRegionRows);
    consistencyChecks += 1;
  }

  if (writes % GLOBAL_COUNT_CHECK_INTERVAL === 0) {
    const totalCount = readCount((await db.query(`SELECT COUNT(*) FROM ${TABLE}`)).rows);
    assert.equal(totalCount, expectedTotalRows);
    consistencyChecks += 1;
  }

  await new Promise<void>((done) => setTimeout(done, WRITE_INTERVAL_MS));
}

const durationMs = Number((performance.now() - startedAt).toFixed(3));
const writesPerSec = Number(((writes * 1000) / Math.max(durationMs, 1)).toFixed(3));
assert.equal(errors, 0);
assert.ok(writes >= MIN_WRITES);
assert.ok(consistencyChecks >= 3);
assert.ok(latenciesMs.length >= MIN_WINDOW_SIZE * 2);

const windowSize = Math.floor(latenciesMs.length / 3);
assert.ok(windowSize >= MIN_WINDOW_SIZE);

const baselineWindow = latenciesMs.slice(0, windowSize);
const tailWindow = latenciesMs.slice(-windowSize);
const baselineAvgMs = Number(average(baselineWindow).toFixed(6));
const tailAvgMs = Number(average(tailWindow).toFixed(6));
const degradationRatio = Number((tailAvgMs / Math.max(baselineAvgMs, 0.000001)).toFixed(6));
const correlatedProbeCount = readCount((await db.query(CORRELATED_EXISTS_PROBE_SQL)).rows);
const existsStats = db.getSubqueryExecutionStats(CORRELATED_EXISTS_SUBQUERY_SQL)[0];

assert.ok(writesPerSec >= MIN_WRITES_PER_SEC_THRESHOLD);
assert.ok(degradationRatio <= PERF_DEGRADATION_RATIO_THRESHOLD);
assert.equal(correlatedProbeCount, 16);
assert.ok(existsStats);
assert.ok((existsStats?.correlatedExecutions ?? 0) > 0);

const report = {
  benchmark: "p3-test-008-longrun-stability-consistency-performance-threshold",
  at: new Date().toISOString(),
  config: {
    table: TABLE,
    view: VIEW,
    initialRows: INITIAL_ROWS,
    customerBuckets: CUSTOMER_BUCKETS,
    targetCustomer: TARGET_CUSTOMER,
    targetRegion: TARGET_REGION,
    highScoreFloor: HIGH_SCORE_FLOOR,
    durationMsTarget: LONG_RUN_DURATION_MS,
    writeIntervalMs: WRITE_INTERVAL_MS,
    thresholds: {
      minWrites: MIN_WRITES,
      minWindowSize: MIN_WINDOW_SIZE,
      minWritesPerSec: MIN_WRITES_PER_SEC_THRESHOLD,
      degradationRatioMax: PERF_DEGRADATION_RATIO_THRESHOLD,
    },
  },
  consistency: {
    writes,
    errors,
    checks: consistencyChecks,
    expectedTotalRows,
    expectedTargetRows,
    expectedTargetHighScoreRows,
    expectedTargetRegionRows,
  },
  performance: {
    samples: latenciesMs.length,
    durationMs,
    writesPerSec,
    baselineAvgMs,
    tailAvgMs,
    degradationRatio,
    windowSize,
  },
  subquery: {
    sql: CORRELATED_EXISTS_SUBQUERY_SQL,
    probeSql: CORRELATED_EXISTS_PROBE_SQL,
    probeCount: correlatedProbeCount,
    correlatedExecutions: existsStats?.correlatedExecutions ?? 0,
  },
};

const outPath = resolve("reports", "p3-test-008-longrun-stability-report.json");
mkdirSync(resolve("reports"), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`ok: integration P3-TEST-008 long-run stability (consistency + performance threshold) -> ${outPath}`);
