import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
  transactionCommitExecutor: async () => ({ digest: "ok" }),
});

await db.execute("CREATE TABLE p3_opt3_users (id INT PRIMARY KEY, score INT, segment TEXT)");

await db.execute("BEGIN");
await db.execute("INSERT INTO p3_opt3_users (id, score, segment) VALUES (1, 10, 'A')");
await db.execute("INSERT INTO p3_opt3_users (id, score, segment) VALUES (2, 20, 'B')");
await db.execute("COMMIT");

await db.execute("BEGIN");
await db.execute("UPDATE p3_opt3_users SET score = NULL WHERE id = 2");
await db.execute("INSERT INTO p3_opt3_users (id, score, segment) VALUES (3, 30, 'C')");
await db.execute("COMMIT");

const history = db.getOptimizerStatsVersionObjects("p3_opt3_users");
assert.equal(history.length, 2);
assert.equal(history[0]?.prevVersion, null);
assert.equal(history[0]?.currentVersion, 1);
assert.equal(history[1]?.prevVersion, 1);
assert.equal(history[1]?.currentVersion, 2);
assert.equal(history[0]?.confirmationStatus, "pending");
assert.equal(history[1]?.confirmationStatus, "pending");
assert.ok(history[0]?.commitDigest);
assert.ok(history[1]?.commitDigest);

const pendingStats = db.getOptimizerStatistics("p3_opt3_users", {
  source: "versioned",
  visibility: "pending",
});
assert.equal(pendingStats.length, 1);
assert.equal(pendingStats[0]?.rowCount, 3);
const pendingScore = pendingStats[0]?.columns.find((column) => column.column === "score");
assert.ok(pendingScore);
assert.equal(pendingScore?.ndv, 2);
assert.equal(pendingScore?.nullCount, 1);

const confirmedBefore = db.getOptimizerStatistics("p3_opt3_users", {
  source: "versioned",
  visibility: "confirmed",
});
assert.equal(confirmedBefore.length, 0);

const confirmedV1 = db.confirmOptimizerStatsVersionObject("p3_opt3_users", 1);
assert.ok(confirmedV1);
assert.equal(confirmedV1?.currentVersion, 1);
assert.equal(confirmedV1?.confirmationStatus, "confirmed");

const replayV1 = db.replayOptimizerStatistics("p3_opt3_users", { version: 1 });
assert.ok(replayV1);
assert.equal(replayV1?.rowCount, 2);
const replayScoreV1 = replayV1?.columns.find((column) => column.column === "score");
assert.ok(replayScoreV1);
assert.equal(replayScoreV1?.ndv, 2);
assert.equal(replayScoreV1?.nullCount, 0);

const confirmedAfterV1 = db.getOptimizerStatistics("p3_opt3_users", {
  source: "versioned",
  visibility: "confirmed",
});
assert.equal(confirmedAfterV1.length, 1);
assert.equal(confirmedAfterV1[0]?.rowCount, 2);

const confirmedLatestObject = db.confirmOptimizerStatsVersionObject("p3_opt3_users");
assert.ok(confirmedLatestObject);
assert.equal(confirmedLatestObject?.currentVersion, 2);
assert.equal(confirmedLatestObject?.confirmationStatus, "confirmed");

const replayConfirmed = db.replayOptimizerStatistics("p3_opt3_users", { visibility: "confirmed" });
assert.ok(replayConfirmed);
assert.equal(replayConfirmed?.rowCount, 3);
assert.equal(
  replayConfirmed?.columns.find((column) => column.column === "score")?.nullCount,
  1,
);

const diff = db.compareOptimizerStatisticsVersions("p3_opt3_users", 1, 2);
assert.ok(diff);
assert.equal(diff?.table, "p3_opt3_users");
assert.equal(diff?.rowCountDelta, 1);
assert.ok((diff?.analyzedAtDeltaMs ?? 0) >= 0);
assert.ok(diff?.addedColumns.length === 0);
assert.ok(diff?.removedColumns.length === 0);

const scoreChange = diff?.changedColumns.find((change) => change.column === "score");
assert.ok(scoreChange);
assert.equal(scoreChange?.ndvDelta, 0);
assert.equal(scoreChange?.nullCountDelta, 1);
assert.ok(Number(scoreChange?.nullRatioDelta ?? 0) > 0);

const idChange = diff?.changedColumns.find((change) => change.column === "id");
assert.ok(idChange);
assert.equal(idChange?.ndvDelta, 1);

const missingDiff = db.compareOptimizerStatisticsVersions("p3_opt3_users", 1, 999);
assert.equal(missingDiff, null);

console.log("ok: P3-OPT-003 statistics persistence/version replay/compare");
