import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_test3_users (id INT PRIMARY KEY, score INT, payload TEXT)");
await db.execute("CREATE INDEX idx_p3_test3_score ON p3_test3_users(score)");

for (let i = 1; i <= 100; i += 1) {
  await db.execute(`INSERT INTO p3_test3_users (id, score, payload) VALUES (${i}, ${i}, 'u${i}')`);
}

const selectiveExplain = (await db.query(
  "EXPLAIN SELECT score FROM p3_test3_users WHERE score >= 40 AND score < 50",
)).rows[0]!;
assert.equal(selectiveExplain.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(selectiveExplain.physicalOptimizerIndexStrategy, "INDEX_SCAN");
assert.equal(selectiveExplain.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(selectiveExplain.physicalIndexStrategy, "INDEX_SCAN");

const broadExplain = (await db.query(
  "EXPLAIN SELECT payload FROM p3_test3_users WHERE score >= 1",
)).rows[0]!;
assert.equal(broadExplain.physicalOptimizerAccessPath, "TABLE_SCAN");
assert.equal(broadExplain.physicalOptimizerIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(broadExplain.physicalAccessPath, "TABLE_SCAN");
assert.equal(broadExplain.physicalIndexStrategy, "FULL_TABLE_SCAN");

await db.execute("CREATE TABLE p3_test3_orders (id INT PRIMARY KEY, customer_id INT, region_id INT)");
await db.execute("CREATE TABLE p3_test3_customers (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE p3_test3_regions (id INT PRIMARY KEY, region_name TEXT)");

for (let i = 1; i <= 120; i += 1) {
  const tier = i <= 12 ? 1 : 2;
  await db.execute(`INSERT INTO p3_test3_customers (id, tier) VALUES (${i}, ${tier})`);
}

await db.execute("INSERT INTO p3_test3_regions (id, region_name) VALUES (1, 'north')");
await db.execute("INSERT INTO p3_test3_regions (id, region_name) VALUES (2, 'south')");

for (let i = 1; i <= 360; i += 1) {
  const customerId = ((i - 1) % 120) + 1;
  const regionId = i % 2 === 0 ? 1 : 2;
  await db.execute(
    `INSERT INTO p3_test3_orders (id, customer_id, region_id) VALUES (${i}, ${customerId}, ${regionId})`,
  );
}

const joinExplain = (await db.query(
  "EXPLAIN SELECT id FROM p3_test3_orders INNER JOIN p3_test3_regions ON p3_test3_orders.region_id = p3_test3_regions.id INNER JOIN p3_test3_customers ON p3_test3_orders.customer_id = p3_test3_customers.id WHERE p3_test3_customers.tier = 1",
)).rows[0]!;
assert.equal(joinExplain.logicalJoinCount, 2);
assert.equal(joinExplain.logicalJoinReorderApplied, true);
assert.equal(joinExplain.logicalJoinReorderAlgorithm, "GREEDY_CBO");
assert.equal(joinExplain.logicalJoinOrderOriginal, "p3_test3_regions -> p3_test3_customers");
assert.equal(joinExplain.logicalJoinOrderFinal, "p3_test3_customers -> p3_test3_regions");

const joinRows = (await db.query(
  "SELECT id FROM p3_test3_orders INNER JOIN p3_test3_regions ON p3_test3_orders.region_id = p3_test3_regions.id INNER JOIN p3_test3_customers ON p3_test3_orders.customer_id = p3_test3_customers.id WHERE p3_test3_customers.tier = 1 ORDER BY p3_test3_orders.id ASC",
)).rows;
assert.equal(joinRows.length, 36);
assert.equal(joinRows[0]?.id, 1);
assert.equal(joinRows[35]?.id, 252);

const fallbackSql = "SELECT id FROM p3_test3_users WHERE score >= 10";

const explainBefore = (await db.query(`EXPLAIN ${fallbackSql}`)).rows[0]!;
assert.equal(explainBefore.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBefore.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBefore.physicalStabilityReason, "NONE");

const firstFallbackRun = await db.query(fallbackSql);
assert.equal(firstFallbackRun.rows.length, 91);

const stateAfterFirstRun = db.getSelectPlanStability(fallbackSql)[0];
assert.ok(stateAfterFirstRun);
assert.equal(stateAfterFirstRun?.preferredMethod, "TABLE_SCAN");
assert.equal(stateAfterFirstRun?.lastReason, "BAD_PLAN_TRIGGER");
assert.equal(stateAfterFirstRun?.badPlanFallbackCount, 1);
assert.ok((stateAfterFirstRun?.badPlanFallbackRemaining ?? 0) >= 1);

const explainPinned = (await db.query(`EXPLAIN ${fallbackSql}`)).rows[0]!;
assert.equal(explainPinned.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainPinned.physicalAccessPath, "TABLE_SCAN");
assert.equal(explainPinned.physicalStabilityReason, "BAD_PLAN_FALLBACK_PIN");
assert.ok(Number(explainPinned.physicalBadPlanFallbackRemaining ?? 0) >= 1);

const secondFallbackRun = await db.query(fallbackSql);
assert.equal(secondFallbackRun.rows.length, 91);

const stateAfterPinnedRun = db.getSelectPlanStability(fallbackSql)[0];
assert.ok(stateAfterPinnedRun);
assert.equal(stateAfterPinnedRun?.lastReason, "BAD_PLAN_FALLBACK_PIN");
assert.equal(stateAfterPinnedRun?.badPlanFallbackCount, 1);
assert.ok((stateAfterPinnedRun?.badPlanFallbackRemaining ?? 0) < (stateAfterFirstRun?.badPlanFallbackRemaining ?? 0));
assert.equal(stateAfterPinnedRun?.executions, 2);

console.log("ok: integration P3-TEST-003 CBO plan selection and plan-stability regression");
