import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

type RecoveryScenarioExpectation = {
  expectedRows: Array<{ id: number; score: number | null; segment: string }>;
  expectedVersionCount: number;
  expectedPendingRowCount: number;
  expectedPendingScoreNullCount: number;
  expectedPendingScoreNdv: number;
};

async function runScenario(
  strategy: "replay" | "rollback",
  expectation: RecoveryScenarioExpectation,
): Promise<void> {
  const walDir = await mkdtemp(join(tmpdir(), `walrus-sql-p3-test-002-${strategy}-`));
  const walPath = join(walDir, "txn.wal.ndjson");
  const table = `p3_test2_users_${strategy}`;
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

    await db.execute(`CREATE TABLE ${table} (id INT PRIMARY KEY, score INT, segment TEXT)`);

    await db.execute("BEGIN");
    await db.execute(`INSERT INTO ${table} (id, score, segment) VALUES (1, 10, 'A')`);
    await db.execute(`INSERT INTO ${table} (id, score, segment) VALUES (2, 20, 'B')`);
    await db.execute("COMMIT");

    const collectedAfterFirstCommit = db.getOptimizerStatistics(table);
    assert.equal(collectedAfterFirstCommit.length, 1);
    assert.equal(collectedAfterFirstCommit[0]?.rowCount, 2);
    const collectedScoreAfterFirstCommit = collectedAfterFirstCommit[0]?.columns.find((column) => column.column === "score");
    assert.ok(collectedScoreAfterFirstCommit);
    assert.equal(collectedScoreAfterFirstCommit?.ndv, 2);
    assert.equal(collectedScoreAfterFirstCommit?.nullCount, 0);

    const persistedAfterFirstCommit = db.getOptimizerStatsVersionObjects(table);
    assert.equal(persistedAfterFirstCommit.length, 1);
    assert.equal(persistedAfterFirstCommit[0]?.currentVersion, 1);
    assert.equal(persistedAfterFirstCommit[0]?.statistics.rowCount, 2);
    assert.equal(persistedAfterFirstCommit[0]?.confirmationStatus, "pending");

    await db.execute("BEGIN");
    await db.execute(`UPDATE ${table} SET score = NULL WHERE id = 2`);
    await db.execute(`INSERT INTO ${table} (id, score, segment) VALUES (3, 30, 'C')`);
    await assert.rejects(db.execute("COMMIT"), /commit bridge interrupted/);

    const pendingBeforeRecovery = await db.recoverPendingTransactionLogsFromWal();
    assert.equal(pendingBeforeRecovery.length, 1);

    const liveBeforeRecovery = db.getOptimizerStatistics(table);
    assert.equal(liveBeforeRecovery.length, 1);
    assert.equal(liveBeforeRecovery[0]?.rowCount, 2);
    assert.equal(
      liveBeforeRecovery[0]?.columns.find((column) => column.column === "score")?.nullCount,
      0,
    );

    const internals = db as unknown as {
      tables: Map<string, Array<Record<string, unknown>>>;
      rowVersions: Map<string, Map<string, number>>;
    };
    internals.tables.set(table, [{ id: 999, score: 999, segment: "corrupt" }]);
    internals.rowVersions.set(table, new Map([["corrupt", 999]]));

    const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: strategy });
    assert.equal(recovery.strategy, strategy);
    assert.equal(recovery.pendingBefore.length, 1);
    assert.deepEqual(recovery.pendingAfter, []);
    assert.ok(recovery.restoredTables.includes(table));

    const rows = (await db.query(`SELECT id, score, segment FROM ${table} ORDER BY id ASC`)).rows;
    assert.deepEqual(rows, expectation.expectedRows);

    const collectedAfterRecovery = db.getOptimizerStatistics(table);
    assert.equal(collectedAfterRecovery.length, 1);
    assert.equal(collectedAfterRecovery[0]?.rowCount, expectation.expectedRows.length);
    const collectedScoreAfterRecovery = collectedAfterRecovery[0]?.columns.find((column) => column.column === "score");
    assert.ok(collectedScoreAfterRecovery);
    assert.equal(collectedScoreAfterRecovery?.ndv, expectation.expectedPendingScoreNdv);
    assert.equal(collectedScoreAfterRecovery?.nullCount, expectation.expectedPendingScoreNullCount);

    const persistedAfterRecovery = db.getOptimizerStatsVersionObjects(table);
    assert.equal(persistedAfterRecovery.length, expectation.expectedVersionCount);
    assert.equal(
      persistedAfterRecovery[persistedAfterRecovery.length - 1]?.statistics.rowCount,
      expectation.expectedPendingRowCount,
    );

    const pendingReplay = db.replayOptimizerStatistics(table, { visibility: "pending" });
    assert.ok(pendingReplay);
    assert.equal(pendingReplay?.rowCount, expectation.expectedPendingRowCount);
    assert.equal(
      pendingReplay?.columns.find((column) => column.column === "score")?.nullCount,
      expectation.expectedPendingScoreNullCount,
    );
    assert.equal(
      pendingReplay?.columns.find((column) => column.column === "score")?.ndv,
      expectation.expectedPendingScoreNdv,
    );
  } finally {
    await rm(walDir, { recursive: true, force: true });
  }
}

await runScenario("replay", {
  expectedRows: [
    { id: 1, score: 10, segment: "A" },
    { id: 2, score: null, segment: "B" },
    { id: 3, score: 30, segment: "C" },
  ],
  expectedVersionCount: 2,
  expectedPendingRowCount: 3,
  expectedPendingScoreNullCount: 1,
  expectedPendingScoreNdv: 2,
});

await runScenario("rollback", {
  expectedRows: [
    { id: 1, score: 10, segment: "A" },
    { id: 2, score: 20, segment: "B" },
  ],
  expectedVersionCount: 1,
  expectedPendingRowCount: 2,
  expectedPendingScoreNullCount: 0,
  expectedPendingScoreNdv: 2,
});

console.log("ok: P3-TEST-002 optimizer statistics collection/persistence/recovery");
