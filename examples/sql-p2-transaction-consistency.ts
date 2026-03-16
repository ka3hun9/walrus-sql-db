import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "walrus-p2-mile-006-"));
const walPath = join(tmpRoot, "transaction.wal.ndjson");
const walArchivePath = join(tmpRoot, "transaction.wal.archive.ndjson");
const walCheckpointPath = join(tmpRoot, "transaction.wal.checkpoint.json");

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    isolationLevel: "read_committed",
    transactionTimeoutMs: 5_000,
    readCache: { enabled: false },
    wal: {
      enabled: true,
      filePath: walPath,
      archivePath: walArchivePath,
      checkpointPath: walCheckpointPath,
      maxEntries: 128,
    },
    transactionCommitExecutor: async (payload) => ({
      digest: `digest-${payload.txnId}`,
    }),
  });

  await db.execute("CREATE TABLE p2_accounts (id INT PRIMARY KEY, balance INT)");

  await db.execute("BEGIN");
  await db.execute("INSERT INTO p2_accounts (id, balance) VALUES (1, 100)");
  await db.execute("COMMIT");
  assert.equal(db.getTransactionState(), "idle");

  const confirmedV1 = db.confirmVersionObject("p2_accounts", 1);
  assert.equal(confirmedV1?.confirmationStatus, "confirmed");

  await db.execute("BEGIN");
  await db.execute("UPDATE p2_accounts SET balance = 105 WHERE id = 1");
  const inRollbackTxn = await db.query("SELECT balance FROM p2_accounts WHERE id = 1");
  assert.equal(inRollbackTxn.rows[0]?.balance, 105);
  await db.execute("ROLLBACK");

  const afterRollback = await db.query("SELECT balance FROM p2_accounts WHERE id = 1");
  assert.equal(afterRollback.rows[0]?.balance, 100);

  await db.execute("BEGIN");
  await db.execute("UPDATE p2_accounts SET balance = 125 WHERE id = 1");
  const inCommitTxn = await db.query("SELECT balance FROM p2_accounts WHERE id = 1");
  assert.equal(inCommitTxn.rows[0]?.balance, 125);
  await db.execute("COMMIT");

  const pendingRead = await db.queryLatestCommitted("SELECT balance FROM p2_accounts WHERE id = 1");
  assert.equal(pendingRead.rows[0]?.balance, 125);

  const confirmedBefore = await db.queryByConfirmation("SELECT balance FROM p2_accounts WHERE id = 1", "confirmed");
  assert.equal(confirmedBefore.rows[0]?.balance, 100);

  const confirmedLatest = db.confirmVersionObject("p2_accounts");
  assert.equal(confirmedLatest?.currentVersion, 2);
  assert.equal(confirmedLatest?.confirmationStatus, "confirmed");

  const confirmedAfter = await db.queryByConfirmation("SELECT balance FROM p2_accounts WHERE id = 1", "confirmed");
  assert.equal(confirmedAfter.rows[0]?.balance, 125);

  const stats = db.getTransactionObservabilityStats();
  assert.equal(stats.started, 3);
  assert.equal(stats.committed, 2);
  assert.equal(stats.aborted, 1);

  const pendingWal = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(pendingWal.length, 0);

  const checkpoint = await db.checkpointWal();
  assert.equal(checkpoint.checkpointPath, walCheckpointPath);
  assert.ok(checkpoint.walLineCount > 0);
  assert.ok(readFileSync(walCheckpointPath, "utf8").includes("\"pendingTxnIds\""));

  const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: "rollback" });
  assert.equal(recovery.strategy, "rollback");
  assert.equal(recovery.pendingAfter.length, 0);
  assert.equal(recovery.restoredTables.includes("p2_accounts"), true);

  const afterRecovery = await db.query("SELECT balance FROM p2_accounts WHERE id = 1");
  assert.equal(afterRecovery.rows[0]?.balance, 125);

  console.log("sql-p2-transaction-consistency ok");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
