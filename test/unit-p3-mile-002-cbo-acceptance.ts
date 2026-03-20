import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_mile2_users (id INT PRIMARY KEY, score INT, payload TEXT)");
await db.execute("CREATE INDEX idx_p3_mile2_score ON p3_mile2_users(score)");

for (let i = 1; i <= 100; i += 1) {
  await db.execute(`INSERT INTO p3_mile2_users (id, score, payload) VALUES (${i}, ${i}, 'u${i}')`);
}

const stats = db.getOptimizerStatistics("p3_mile2_users");
assert.equal(stats.length, 1);
assert.equal(stats[0]?.rowCount, 100);
const scoreStats = stats[0]?.columns.find((column) => column.column === "score");
assert.ok(scoreStats);
assert.equal(scoreStats?.ndv, 100);
assert.equal(scoreStats?.nullCount, 0);

const selectiveExplain = (await db.query(
  "EXPLAIN SELECT score FROM p3_mile2_users WHERE score >= 40 AND score < 50",
)).rows[0]!;
assert.equal(selectiveExplain.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(selectiveExplain.physicalOptimizerIndexStrategy, "INDEX_SCAN");
assert.equal(selectiveExplain.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(selectiveExplain.physicalIndexStrategy, "INDEX_SCAN");

const broadExplain = (await db.query(
  "EXPLAIN SELECT payload FROM p3_mile2_users WHERE score >= 1",
)).rows[0]!;
assert.equal(broadExplain.physicalOptimizerAccessPath, "TABLE_SCAN");
assert.equal(broadExplain.physicalOptimizerIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(broadExplain.physicalAccessPath, "TABLE_SCAN");
assert.equal(broadExplain.physicalIndexStrategy, "FULL_TABLE_SCAN");

const selectiveSel = Number(selectiveExplain.statsPredicateSelectivity);
const broadSel = Number(broadExplain.statsPredicateSelectivity);
assert.ok(selectiveSel > 0 && selectiveSel < broadSel);
assert.ok(Number(selectiveExplain.statsPredicateEstimatedRows) < Number(broadExplain.statsPredicateEstimatedRows));
assert.ok(Number(selectiveExplain.physicalOptimizerCost) < Number(broadExplain.physicalOptimizerCost));

await db.execute("CREATE TABLE p3_mile2_orders (id INT PRIMARY KEY, customer_id INT, region_id INT)");
await db.execute("CREATE TABLE p3_mile2_customers (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE p3_mile2_regions (id INT PRIMARY KEY, region_name TEXT)");

for (let i = 1; i <= 120; i += 1) {
  const tier = i <= 12 ? 1 : 2;
  await db.execute(`INSERT INTO p3_mile2_customers (id, tier) VALUES (${i}, ${tier})`);
}

await db.execute("INSERT INTO p3_mile2_regions (id, region_name) VALUES (1, 'north')");
await db.execute("INSERT INTO p3_mile2_regions (id, region_name) VALUES (2, 'south')");

for (let i = 1; i <= 360; i += 1) {
  const customerId = ((i - 1) % 120) + 1;
  const regionId = i % 2 === 0 ? 1 : 2;
  await db.execute(
    `INSERT INTO p3_mile2_orders (id, customer_id, region_id) VALUES (${i}, ${customerId}, ${regionId})`,
  );
}

const joinExplain = (await db.query(
  "EXPLAIN SELECT id FROM p3_mile2_orders INNER JOIN p3_mile2_regions ON p3_mile2_orders.region_id = p3_mile2_regions.id INNER JOIN p3_mile2_customers ON p3_mile2_orders.customer_id = p3_mile2_customers.id WHERE p3_mile2_customers.tier = 1",
)).rows[0]!;
assert.equal(joinExplain.logicalJoinCount, 2);
assert.equal(joinExplain.logicalJoinReorderApplied, true);
assert.equal(joinExplain.logicalJoinReorderAlgorithm, "GREEDY_CBO");
assert.equal(joinExplain.logicalJoinOrderOriginal, "p3_mile2_regions -> p3_mile2_customers");
assert.equal(joinExplain.logicalJoinOrderFinal, "p3_mile2_customers -> p3_mile2_regions");

const fallbackSql = "SELECT id FROM p3_mile2_users WHERE score >= 10";
const explainBeforeFallback = (await db.query(`EXPLAIN ${fallbackSql}`)).rows[0]!;
assert.equal(explainBeforeFallback.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBeforeFallback.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBeforeFallback.physicalStabilityReason, "NONE");

const firstFallbackRun = await db.query(fallbackSql);
assert.equal(firstFallbackRun.rows.length, 91);

const fallbackState = db.getSelectPlanStability(fallbackSql)[0];
assert.ok(fallbackState);
assert.equal(fallbackState?.preferredMethod, "TABLE_SCAN");
assert.equal(fallbackState?.lastReason, "BAD_PLAN_TRIGGER");
assert.equal(fallbackState?.badPlanFallbackCount, 1);
assert.ok((fallbackState?.badPlanFallbackRemaining ?? 0) >= 1);

const explainPinned = (await db.query(`EXPLAIN ${fallbackSql}`)).rows[0]!;
assert.equal(explainPinned.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainPinned.physicalAccessPath, "TABLE_SCAN");
assert.equal(explainPinned.physicalStabilityReason, "BAD_PLAN_FALLBACK_PIN");
assert.ok(Number(explainPinned.physicalBadPlanFallbackRemaining ?? 0) >= 1);

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-002\b/.test(checklist), false, "P3-MILE-002 must be checked");

const report = readFileSync("docs/sql-p3-mile-002-cbo-acceptance-report.md", "utf8");
assert.ok(report.includes("## P3-MILE-002"));
assert.ok(report.includes("statistics-driven"));
assert.ok(report.includes("GREEDY_CBO"));
assert.ok(report.includes("BAD_PLAN_FALLBACK_PIN"));
assert.ok(report.includes("PASS"));

console.log("ok: P3-MILE-002 CBO acceptance (statistics-driven plan selection)");
