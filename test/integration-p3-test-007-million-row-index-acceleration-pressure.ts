import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { WalrusSqlClient } from "../src/client.js";

type InternalTableStore = {
  tables: Map<string, Array<Record<string, number>>>;
};

const TABLE = "p3_test7_users";
const INDEX = "idx_p3_test7_score";
const TOTAL_ROWS = 1_000_000;
const DISTINCT_SCORE_BUCKETS = 100_000;
const TARGET_SCORE = 77777;
const EXPECTED_MATCHED_ROWS = Math.floor(TOTAL_ROWS / DISTINCT_SCORE_BUCKETS);
const SQL = `SELECT score FROM ${TABLE} WHERE score = ${TARGET_SCORE}`;

const rows: Array<Record<string, number>> = new Array(TOTAL_ROWS);
for (let i = 0; i < TOTAL_ROWS; i += 1) {
  const id = i + 1;
  rows[i] = {
    id,
    score: id % DISTINCT_SCORE_BUCKETS,
  };
}

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute(`CREATE TABLE ${TABLE} (id INT PRIMARY KEY, score INT)`);
(db as unknown as InternalTableStore).tables.set(TABLE, rows);

const baselineStarted = performance.now();
const baselineResult = await db.query(SQL);
const baselineQueryMs = performance.now() - baselineStarted;
assert.equal(baselineResult.rows.length, EXPECTED_MATCHED_ROWS);

const baselinePipeline = db.getSelectExecutionPipelineStats(SQL)[0];
assert.ok(baselinePipeline);
assert.equal(baselinePipeline?.lastRowsVisited, TOTAL_ROWS);
const baselineRowsVisitedTotal = baselinePipeline?.rowsVisited ?? 0;

const baselineObservability = db.getIndexObservability(TABLE)[0];
assert.equal(baselineObservability?.lookupCount ?? 0, 0);

const indexBuildStarted = performance.now();
await db.execute(`CREATE INDEX ${INDEX} ON ${TABLE}(score)`);
const indexBuildMs = performance.now() - indexBuildStarted;

const btreeStats = db.getBtreeIndexStats(TABLE);
assert.equal(btreeStats.length, 1);
assert.equal(btreeStats[0]?.rowsIndexed, TOTAL_ROWS);

const indexedStarted = performance.now();
const indexedResult = await db.query(SQL);
const indexedQueryMs = performance.now() - indexedStarted;
assert.equal(indexedResult.rows.length, EXPECTED_MATCHED_ROWS);

const indexedPipeline = db.getSelectExecutionPipelineStats(SQL)[0];
assert.ok(indexedPipeline);
assert.equal(indexedPipeline?.lastRowsVisited, EXPECTED_MATCHED_ROWS);

const indexedRowsVisitedTotal = indexedPipeline?.rowsVisited ?? 0;
const indexedRoundRowsVisited = indexedRowsVisitedTotal - baselineRowsVisitedTotal;
assert.equal(indexedRoundRowsVisited, EXPECTED_MATCHED_ROWS);

const indexedObservability = db.getIndexObservability(TABLE)[0];
assert.ok(indexedObservability);
assert.ok((indexedObservability?.lookupCount ?? 0) >= 1);
assert.ok((indexedObservability?.lookupHits ?? 0) >= 1);

const scanReductionRatio = Number(
  ((baselinePipeline?.lastRowsVisited ?? 0) / Math.max(1, indexedPipeline?.lastRowsVisited ?? 1)).toFixed(3),
);
assert.ok(scanReductionRatio >= 10_000);

const latencySpeedupRatio = Number((baselineQueryMs / Math.max(indexedQueryMs, 0.000001)).toFixed(6));

const report = {
  benchmark: "p3-test-007-million-row-index-acceleration-pressure",
  at: new Date().toISOString(),
  dataset: {
    totalRows: TOTAL_ROWS,
    distinctScoreBuckets: DISTINCT_SCORE_BUCKETS,
    targetScore: TARGET_SCORE,
    expectedMatchedRows: EXPECTED_MATCHED_ROWS,
  },
  baseline: {
    queryMs: Number(baselineQueryMs.toFixed(3)),
    rowsVisitedTotal: baselineRowsVisitedTotal,
    lastRowsVisited: baselinePipeline?.lastRowsVisited ?? 0,
    indexLookupCount: baselineObservability?.lookupCount ?? 0,
  },
  indexed: {
    indexBuildMs: Number(indexBuildMs.toFixed(3)),
    queryMs: Number(indexedQueryMs.toFixed(3)),
    rowsVisitedTotal: indexedRowsVisitedTotal,
    rowsVisitedThisRound: indexedRoundRowsVisited,
    lastRowsVisited: indexedPipeline?.lastRowsVisited ?? 0,
    indexLookupCount: indexedObservability?.lookupCount ?? 0,
    indexLookupHits: indexedObservability?.lookupHits ?? 0,
    btreeRowsIndexed: btreeStats[0]?.rowsIndexed ?? 0,
    btreeKeys: btreeStats[0]?.keys ?? 0,
  },
  derived: {
    scanReductionRatio,
    latencySpeedupRatio,
  },
};

const outPath = resolve("reports", "p3-test-007-million-row-index-acceleration-bench.json");
mkdirSync(resolve("reports"), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`ok: integration P3-TEST-007 million-row index acceleration pressure -> ${outPath}`);
