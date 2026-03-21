import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

async function runRecoveryScenario(
  strategy: "replay" | "rollback",
  expectedRows: Array<{ id: number; score: number }>,
): Promise<void> {
  const walDir = await mkdtemp(join(tmpdir(), `walrus-sql-p3-idx-007-${strategy}-`));
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

    await db.execute("CREATE TABLE idx_recover (id INT PRIMARY KEY, score INT)");
    await db.execute("INSERT INTO idx_recover (id, score) VALUES (1, 10)");
    await db.execute("CREATE INDEX idx_recover_score ON idx_recover(score)");

    await db.execute("BEGIN");
    await db.execute("UPDATE idx_recover SET score = 20 WHERE id = 1");
    await db.execute("COMMIT");

    await db.execute("BEGIN");
    await db.execute("INSERT INTO idx_recover (id, score) VALUES (2, 30)");
    await db.execute("UPDATE idx_recover SET score = 25 WHERE id = 1");
    await assert.rejects(db.execute("COMMIT"), /commit bridge interrupted/);

    const pendingBeforeRecovery = await db.recoverPendingTransactionLogsFromWal();
    assert.equal(pendingBeforeRecovery.length, 1);

    const internals = db as unknown as {
      tables: Map<string, Array<Record<string, unknown>>>;
      hashIndexes: Map<string, unknown>;
      hashIndexStats: Map<string, unknown>;
      btreeIndexes: Map<string, unknown>;
      btreeIndexStats: Map<string, unknown>;
    };
    internals.tables.set("idx_recover", [{ id: 1, score: 999 }]);
    internals.hashIndexes.delete("idx_recover");
    internals.hashIndexStats.delete("idx_recover");
    internals.btreeIndexes.delete("idx_recover");
    internals.btreeIndexStats.delete("idx_recover");

    const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: strategy });
    assert.equal(recovery.strategy, strategy);
    assert.equal(recovery.pendingBefore.length, 1);
    assert.deepEqual(recovery.pendingAfter, []);

    const rowsById = (await db.query("SELECT id, score FROM idx_recover ORDER BY id ASC")).rows;
    assert.deepEqual(rowsById, expectedRows);

    const rowsByScore = (await db.query("SELECT id, score FROM idx_recover ORDER BY score ASC")).rows;
    const expectedByScore = [...expectedRows].sort((a, b) => a.score - b.score);
    assert.deepEqual(rowsByScore, expectedByScore);

    const btreeStats = db.getBtreeIndexStats("idx_recover");
    assert.equal(btreeStats.length, 1);
    assert.equal(btreeStats[0]?.rowsIndexed, expectedRows.length);
  } finally {
    await rm(walDir, { recursive: true, force: true });
  }
}

await runRecoveryScenario("replay", [
  { id: 1, score: 25 },
  { id: 2, score: 30 },
]);

await runRecoveryScenario("rollback", [
  { id: 1, score: 20 },
]);

console.log("ok: P3-IDX-007 wal replay/rollback + version-chain index consistency");
