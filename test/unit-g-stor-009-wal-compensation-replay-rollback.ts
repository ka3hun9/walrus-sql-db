import { strict as assert } from "node:assert";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";
import { createTransactionLogRecord, type TransactionWalEntry } from "../src/types.js";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-log-004-"));
const walPath = join(walDir, "txn.wal.ndjson");

let commitAttempts = 0;

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    wal: { enabled: true, filePath: walPath },
    transactionCommitExecutor: async () => {
      commitAttempts += 1;
      if (commitAttempts === 1) throw new Error("commit bridge unavailable");
      return { digest: `ok-${commitAttempts}` };
    },
  });

  await db.execute("CREATE TABLE wal_comp (id INT PRIMARY KEY, v INT)");
  await db.execute("BEGIN");
  await db.execute("INSERT INTO wal_comp (id, v) VALUES (1, 10)");

  await assert.rejects(
    db.execute("COMMIT"),
    /ERR_EXECUTION_FAILED: execute\(\) failed: commit bridge unavailable/,
  );

  const pendingAfterFailure = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(pendingAfterFailure.length, 1);
  const failedTxnId = pendingAfterFailure[0]!.txnId;

  const firstWal = await readFile(walPath, "utf8");
  const firstEntries = firstWal
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TransactionWalEntry);
  assert.deepEqual(firstEntries.map((entry) => entry.phase), ["PREPARE"]);

  const replayResult = await db.replayPendingTransactionLogsFromWal();
  assert.deepEqual(replayResult.failedTxnIds, []);
  assert.deepEqual(replayResult.replayedTxnIds, [failedTxnId]);

  const replayAgain = await db.replayPendingTransactionLogsFromWal();
  assert.deepEqual(replayAgain, { replayedTxnIds: [], failedTxnIds: [] });

  const dangling = createTransactionLogRecord({
    txnId: "txn_dangling_rollback_001",
    at: Date.now(),
    writeSet: [
      {
        table: "wal_comp",
        op: "INSERT",
        key: { id: 99 },
        preImage: null,
        postImage: { id: 99, v: 99 },
      },
    ],
  });
  await appendFile(
    walPath,
    `${JSON.stringify({ phase: "PREPARE", txnId: dangling.txnId, at: Date.now(), record: dangling })}\n`,
    "utf8",
  );

  const rolledBackTxnIds = await db.rollbackPendingTransactionLogsFromWal();
  assert.deepEqual(rolledBackTxnIds, [dangling.txnId]);

  const rollbackAgain = await db.rollbackPendingTransactionLogsFromWal();
  assert.deepEqual(rollbackAgain, []);
} finally {
  await rm(walDir, { recursive: true, force: true });
}

console.log("ok: G-STOR-009 WAL compensation replay/rollback idempotency");
