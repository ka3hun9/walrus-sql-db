import { strict as assert } from "node:assert";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";
import { createTransactionLogRecord } from "../src/types.js";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-log-005-"));
const walPath = join(walDir, "txn.wal.ndjson");
const archivePath = join(walDir, "txn.wal.archive.ndjson");
const checkpointPath = join(walDir, "txn.wal.checkpoint.json");

const countLines = (text: string): number =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    wal: {
      enabled: true,
      filePath: walPath,
      archivePath,
      checkpointPath,
      maxEntries: 3,
    },
  });

  await db.execute("CREATE TABLE wal_ret (id INT PRIMARY KEY, v INT)");

  for (let i = 1; i <= 3; i += 1) {
    await db.execute("BEGIN");
    await db.execute(`INSERT INTO wal_ret (id, v) VALUES (${i}, ${i * 10})`);
    await db.execute("COMMIT");
  }

  const walText = await readFile(walPath, "utf8");
  const archiveText = await readFile(archivePath, "utf8");
  assert.equal(countLines(walText) <= 3, true);
  assert.equal(countLines(archiveText) >= 3, true);

  const firstCheckpoint = await db.checkpointWal();
  assert.equal(firstCheckpoint.checkpointPath, checkpointPath);
  assert.equal(firstCheckpoint.walLineCount, countLines(walText));
  assert.deepEqual(firstCheckpoint.pendingTxnIds, []);

  const dangling = createTransactionLogRecord({
    txnId: "txn_checkpoint_pending_001",
    at: Date.now(),
    writeSet: [
      {
        table: "wal_ret",
        op: "INSERT",
        key: { id: 99 },
        preImage: null,
        postImage: { id: 99, v: 990 },
      },
    ],
  });
  await appendFile(
    walPath,
    `${JSON.stringify({ phase: "PREPARE", txnId: dangling.txnId, at: Date.now(), record: dangling })}\n`,
    "utf8",
  );

  const secondCheckpoint = await db.checkpointWal();
  assert.deepEqual(secondCheckpoint.pendingTxnIds, [dangling.txnId]);

  const checkpointBody = JSON.parse(await readFile(checkpointPath, "utf8")) as {
    pendingTxnIds: string[];
    pendingRecords: Array<{ txnId: string }>;
  };
  assert.deepEqual(checkpointBody.pendingTxnIds, [dangling.txnId]);
  assert.deepEqual(checkpointBody.pendingRecords.map((record) => record.txnId), [dangling.txnId]);
} finally {
  await rm(walDir, { recursive: true, force: true });
}

console.log("ok: G-STOR-010 WAL checkpoint and retention");
