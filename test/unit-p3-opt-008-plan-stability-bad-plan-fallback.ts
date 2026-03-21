import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_opt8_users (id INT PRIMARY KEY, score INT)");
await db.execute("CREATE INDEX idx_p3_opt8_score ON p3_opt8_users(score)");

for (let i = 1; i <= 100; i += 1) {
  await db.execute(`INSERT INTO p3_opt8_users (id, score) VALUES (${i}, ${i})`);
}

const sql = "SELECT id FROM p3_opt8_users WHERE score >= 10";

const explainBefore = (await db.query(`EXPLAIN ${sql}`)).rows[0]!;
assert.equal(explainBefore.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBefore.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBefore.physicalStabilityReason, "NONE");

const first = await db.query(sql);
assert.equal(first.rows.length, 91);

const stateAfterFirst = db.getSelectPlanStability(sql)[0];
assert.ok(stateAfterFirst);
assert.equal(stateAfterFirst!.lastReason, "BAD_PLAN_TRIGGER");
assert.equal(stateAfterFirst!.preferredMethod, "TABLE_SCAN");
assert.ok(stateAfterFirst!.badPlanFallbackRemaining >= 1);

const explainPinned = (await db.query(`EXPLAIN ${sql}`)).rows[0]!;
assert.equal(explainPinned.physicalOptimizerAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainPinned.physicalAccessPath, "TABLE_SCAN");
assert.equal(explainPinned.physicalStabilityReason, "BAD_PLAN_FALLBACK_PIN");
assert.ok(Number(explainPinned.physicalBadPlanFallbackRemaining) >= 1);

await db.query(sql);
const stateAfterPinnedRun = db.getSelectPlanStability(sql)[0];
assert.ok(stateAfterPinnedRun);
assert.ok(stateAfterPinnedRun!.badPlanFallbackRemaining <= stateAfterFirst!.badPlanFallbackRemaining);

console.log("ok: P3-OPT-008 plan stability and bad-plan fallback");
