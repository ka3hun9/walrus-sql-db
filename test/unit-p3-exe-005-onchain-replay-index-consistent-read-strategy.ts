import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

let commitCalls = 0;
const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
  transactionCommitExecutor: async () => ({ digest: `ok-${++commitCalls}` }),
});

await db.execute("CREATE TABLE p3_exe5_users (id INT PRIMARY KEY, score INT, note TEXT)");
for (let i = 1; i <= 8; i += 1) {
  await db.execute(`INSERT INTO p3_exe5_users (id, score, note) VALUES (${i}, ${i * 10}, 'n${i}')`);
}
await db.execute("CREATE INDEX idx_p3_exe5_score ON p3_exe5_users(score)");

const indexHistory = db.getIndexVersionObjects("idx_p3_exe5_score");
assert.equal(indexHistory.length, 1);
assert.equal(indexHistory[0]?.confirmationStatus, "pending");

const pendingExplain = (await db.queryByConfirmation(
  "EXPLAIN SELECT id FROM p3_exe5_users WHERE score = 40",
  "pending",
)).rows[0]!;
assert.equal(pendingExplain.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.ok(["INDEX_SCAN", "INDEX_BACK_TABLE"].includes(String(pendingExplain.physicalIndexStrategy)));

const confirmedExplainBeforeConfirm = (await db.queryByConfirmation(
  "EXPLAIN SELECT id FROM p3_exe5_users WHERE score = 40",
  "confirmed",
)).rows[0]!;
assert.equal(confirmedExplainBeforeConfirm.physicalAccessPath, "TABLE_SCAN");
assert.equal(confirmedExplainBeforeConfirm.physicalIndexStrategy, "FULL_TABLE_SCAN");

const confirmedRowsBeforeConfirm = (await db.queryByConfirmation(
  "SELECT id FROM p3_exe5_users WHERE score = 40",
  "confirmed",
)).rows;
assert.deepEqual(confirmedRowsBeforeConfirm, [{ id: 4 }]);

const confirmed = db.confirmIndexVersionObject("idx_p3_exe5_score", 1);
assert.equal(confirmed?.confirmationStatus, "confirmed");

const confirmedExplainAfterConfirm = (await db.queryByConfirmation(
  "EXPLAIN SELECT id FROM p3_exe5_users WHERE score = 40",
  "confirmed",
)).rows[0]!;
assert.equal(confirmedExplainAfterConfirm.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.ok(["INDEX_SCAN", "INDEX_BACK_TABLE"].includes(String(confirmedExplainAfterConfirm.physicalIndexStrategy)));

const confirmedRowsAfterConfirm = (await db.queryByConfirmation(
  "SELECT id FROM p3_exe5_users WHERE score = 40",
  "confirmed",
)).rows;
assert.deepEqual(confirmedRowsAfterConfirm, [{ id: 4 }]);

console.log("ok: P3-EXE-005 onchain/replay read path index-consistent visibility strategy");
