import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_opt5_users (id INT PRIMARY KEY, score INT, payload TEXT)");
await db.execute("CREATE INDEX idx_p3_opt5_score ON p3_opt5_users(score)");

for (let i = 1; i <= 200; i += 1) {
  await db.execute(`INSERT INTO p3_opt5_users (id, score, payload) VALUES (${i}, ${i}, 'u${i}')`);
}

const explainCoveringRange = (await db.query(
  "EXPLAIN SELECT score FROM p3_opt5_users WHERE score >= 50 AND score < 60",
)).rows[0]!;
assert.equal(explainCoveringRange.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainCoveringRange.physicalIndexStrategy, "INDEX_SCAN");

const explainBackTableRange = (await db.query(
  "EXPLAIN SELECT payload FROM p3_opt5_users WHERE score >= 50 AND score < 60",
)).rows[0]!;
assert.equal(explainBackTableRange.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainBackTableRange.physicalIndexStrategy, "INDEX_BACK_TABLE");

const explainBackTableBroad = (await db.query(
  "EXPLAIN SELECT payload FROM p3_opt5_users WHERE score >= 1",
)).rows[0]!;
assert.equal(explainBackTableBroad.physicalOptimizerAccessPath, "TABLE_SCAN");
assert.equal(explainBackTableBroad.physicalOptimizerIndexStrategy, "FULL_TABLE_SCAN");
assert.equal(explainBackTableBroad.physicalAccessPath, "TABLE_SCAN");
assert.equal(explainBackTableBroad.physicalIndexStrategy, "FULL_TABLE_SCAN");
assert.match(String(explainBackTableBroad.physicalCandidates ?? ""), /INDEX_BACK_TABLE/);

const explainCoveringBroad = (await db.query(
  "EXPLAIN SELECT score FROM p3_opt5_users WHERE score >= 1",
)).rows[0]!;
assert.equal(explainCoveringBroad.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainCoveringBroad.physicalIndexStrategy, "INDEX_SCAN");

const explainHashCovering = (await db.query(
  "EXPLAIN SELECT id FROM p3_opt5_users WHERE id = 42",
)).rows[0]!;
assert.equal(explainHashCovering.physicalAccessPath, "HASH_INDEX_LOOKUP");
assert.equal(explainHashCovering.physicalIndexStrategy, "INDEX_SCAN");

const explainHashBackTable = (await db.query(
  "EXPLAIN SELECT payload FROM p3_opt5_users WHERE id = 42",
)).rows[0]!;
assert.equal(explainHashBackTable.physicalAccessPath, "HASH_INDEX_LOOKUP");
assert.equal(explainHashBackTable.physicalIndexStrategy, "INDEX_BACK_TABLE");

const rows = (await db.query(
  "SELECT payload FROM p3_opt5_users WHERE score >= 50 AND score < 53 ORDER BY score ASC",
)).rows;
assert.deepEqual(rows, [{ payload: "u50" }, { payload: "u51" }, { payload: "u52" }]);

console.log("ok: P3-OPT-005 index selection strategy (table scan vs index scan vs index back-table)");
