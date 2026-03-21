import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_exe3_pipe (id INT PRIMARY KEY, grp TEXT, payload TEXT)");
for (let i = 1; i <= 240; i += 1) {
  await db.execute(`INSERT INTO p3_exe3_pipe (id, grp, payload) VALUES (${i}, 'g${i % 6}', 'p${i}')`);
}
await db.execute("CREATE INDEX idx_p3_exe3_id ON p3_exe3_pipe(id)");

const pipelinedSql = "SELECT id, payload FROM p3_exe3_pipe ORDER BY id ASC LIMIT 10 OFFSET 20";
const pipelinedExplain = (await db.query(`EXPLAIN ${pipelinedSql}`)).rows[0]!;
assert.equal(pipelinedExplain.executionPipelineEligible, true);
assert.equal(pipelinedExplain.executionPipelineMode, "PIPELINED");
assert.equal(pipelinedExplain.executionPipelineBlockers, null);

const pipelinedRows = (await db.query(pipelinedSql)).rows;
assert.equal(pipelinedRows.length, 10);
assert.deepEqual(pipelinedRows[0], { id: 21, payload: "p21" });
assert.deepEqual(pipelinedRows[9], { id: 30, payload: "p30" });

const pipelinedStats = db.getSelectExecutionPipelineStats(pipelinedSql)[0]!;
assert.equal(pipelinedStats.lastMode, "PIPELINED");
assert.equal(pipelinedStats.lastEarlyStop, true);
assert.equal(pipelinedStats.lastRowsVisited, 30);
assert.equal(pipelinedStats.lastRowsReturned, 10);
assert.equal(pipelinedStats.lastBufferedRows, 10);
assert.equal(pipelinedStats.lastBlockers.length, 0);

const materializedSql = "SELECT id, payload FROM p3_exe3_pipe ORDER BY payload DESC LIMIT 5";
const materializedExplain = (await db.query(`EXPLAIN ${materializedSql}`)).rows[0]!;
assert.equal(materializedExplain.executionPipelineEligible, false);
assert.equal(materializedExplain.executionPipelineMode, "MATERIALIZED");
assert.match(String(materializedExplain.executionPipelineBlockers ?? ""), /ORDER_BY_SORT/);

const materializedRows = (await db.query(materializedSql)).rows;
assert.equal(materializedRows.length, 5);

const materializedStats = db.getSelectExecutionPipelineStats(materializedSql)[0]!;
assert.equal(materializedStats.lastMode, "MATERIALIZED");
assert.equal(materializedStats.lastEarlyStop, false);
assert.equal(materializedStats.lastRowsVisited, 240);
assert.ok(materializedStats.lastBufferedRows >= 240);
assert.ok(materializedStats.lastBlockers.includes("ORDER_BY_SORT"));

console.log("ok: P3-EXE-003 large-result execution pipeline avoids full intermediate materialization");
