import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-dur-003-"));
const walPath = join(walDir, "txn.wal.ndjson");

let commitExecutorCalls = 0;

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    isolationLevel: "read_committed",
    readCache: { enabled: false },
    wal: { enabled: true, filePath: walPath },
    transactionCommitExecutor: async () => {
      commitExecutorCalls += 1;
      if (commitExecutorCalls === 2) throw new Error("commit bridge interrupted");
      return { digest: `ok-${commitExecutorCalls}` };
    },
  });

  await db.execute("CREATE TABLE dur_recover (id INT PRIMARY KEY, v INT)");
  await db.execute("INSERT INTO dur_recover (id, v) VALUES (1, 10)");

  await db.execute("BEGIN");
  await db.execute("UPDATE dur_recover SET v = 11 WHERE id = 1");
  await db.execute("COMMIT");

  await db.execute("BEGIN");
  await db.execute("UPDATE dur_recover SET v = 12 WHERE id = 1");
  await assert.rejects(db.execute("COMMIT"), /commit bridge interrupted/);

  const pendingBeforeRecovery = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(pendingBeforeRecovery.length, 1);

  const internals = db as unknown as { tables: Map<string, Array<Record<string, unknown>>> };
  internals.tables.set("dur_recover", [{ id: 1, v: 999 }]);

  const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: "rollback" });
  assert.equal(recovery.strategy, "rollback");
  assert.deepEqual(recovery.restoredTables, ["dur_recover"]);
  assert.equal(recovery.pendingBefore.length, 1);
  assert.deepEqual(recovery.pendingAfter, []);

  const afterRecovery = await db.query("SELECT id, v FROM dur_recover");
  assert.deepEqual(afterRecovery.rows, [{ id: 1, v: 11 }]);
} finally {
  await rm(walDir, { recursive: true, force: true });
}

console.log("ok: G-STOR-013 crash recovery with WAL + version chain");
