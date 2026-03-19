import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
  joinExecution: {
    memoryBudgetRows: 80,
    spillChunkRows: 25,
  },
});

await db.execute("CREATE TABLE p3_exe4_a (id INT PRIMARY KEY, k INT, payload TEXT)");
await db.execute("CREATE TABLE p3_exe4_b (id INT PRIMARY KEY, k INT, payload TEXT)");
await db.execute("CREATE TABLE p3_exe4_c (id INT PRIMARY KEY, k INT, payload TEXT)");

for (let i = 1; i <= 40; i += 1) {
  const k = i <= 8 ? 1 : 100 + i;
  await db.execute(`INSERT INTO p3_exe4_a (id, k, payload) VALUES (${i}, ${k}, 'a${i}')`);
}

for (let i = 1; i <= 120; i += 1) {
  const k = i <= 40 ? 1 : 1000 + i;
  await db.execute(`INSERT INTO p3_exe4_b (id, k, payload) VALUES (${i}, ${k}, 'b${i}')`);
}

for (let i = 1; i <= 90; i += 1) {
  await db.execute(`INSERT INTO p3_exe4_c (id, k, payload) VALUES (${i}, 1, 'c${i}')`);
}

const sql =
  "SELECT p3_exe4_a.id AS aid FROM p3_exe4_a INNER JOIN p3_exe4_b ON p3_exe4_a.k = p3_exe4_b.k LEFT JOIN p3_exe4_c ON p3_exe4_b.k = p3_exe4_c.k";

const explain = (await db.query(`EXPLAIN ${sql}`)).rows[0]!;
assert.equal(explain.physicalJoinCount, 2);
assert.equal(explain.physicalJoinAlgorithms, "HASH_JOIN -> HASH_JOIN");
assert.equal(explain.physicalJoinMemoryBudgetRows, 80);
assert.equal(explain.physicalJoinSpillChunkRows, 25);

const rows = (await db.query(sql)).rows;
assert.equal(rows.length, 28800);

const stats = db.getSelectExecutionPipelineStats(sql)[0]!;
assert.equal(stats.lastMode, "MATERIALIZED");
assert.equal(stats.lastJoinSpillSteps, 1);
assert.equal(stats.lastJoinSpillChunks, 4);
assert.equal(stats.lastJoinSpillRowsProcessed, 90);
assert.equal(stats.joinSpillExecutions, 1);
assert.equal(stats.joinSpillChunks, 4);
assert.equal(stats.joinSpillRowsProcessed, 90);
assert.ok(stats.lastBlockers.includes("JOIN_CHAIN"));

console.log("ok: P3-EXE-004 spill/chunk strategy handles memory-constrained join runtime");
