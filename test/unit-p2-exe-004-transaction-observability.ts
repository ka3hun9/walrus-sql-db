import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE exe004_t (id INT PRIMARY KEY, v INT)");

await db.execute("BEGIN");
await db.execute("INSERT INTO exe004_t (id, v) VALUES (1, 10)");
await db.execute("COMMIT");

await db.execute("BEGIN");
await assert.rejects(
  db.execute("INSERT INTO exe004_t (id, v) VALUES (1, 99)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY:/,
);
await db.execute("ROLLBACK");

const stats = db.getTransactionObservabilityStats();
assert.equal(stats.started, 2);
assert.equal(stats.committed, 1);
assert.equal(stats.aborted, 1);
assert.equal(stats.abortRatio, 0.5);
assert.ok(stats.avgTxnLatencyMs >= 0);
assert.ok(stats.maxTxnLatencyMs >= 0);
assert.ok(stats.totalTxnLatencyMs >= 0);
assert.ok(stats.totalLockWaitMs >= 0);
assert.ok(stats.lockWaitEvents >= 0);

console.log("ok: P2-EXE-004 transaction observability stats");
