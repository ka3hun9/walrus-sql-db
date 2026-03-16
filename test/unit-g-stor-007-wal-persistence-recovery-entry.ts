import { strict as assert } from "node:assert";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";
import { createTransactionLogRecord, type TransactionWalEntry } from "../src/types.js";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-log-002-"));
const walPath = join(walDir, "txn.wal.ndjson");

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    wal: {
      enabled: true,
      filePath: walPath,
    },
  });

  await db.execute("CREATE TABLE wal_t (id INT PRIMARY KEY, v INT)");
  await db.execute("BEGIN");
  await db.execute("INSERT INTO wal_t (id, v) VALUES (1, 10)");
  await db.execute("UPDATE wal_t SET v = 11 WHERE id = 1");
  await db.execute("COMMIT");

  const walText = await readFile(walPath, "utf8");
  const entries = walText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TransactionWalEntry);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.phase, "PREPARE");
  assert.equal(entries[1]?.phase, "COMMIT");
  assert.ok(entries[0]?.record);
  assert.equal(entries[0]?.record?.txnId, entries[0]?.txnId);
  assert.equal(entries[0]?.record?.writeSet.length, 2);
  assert.equal(entries[0]?.record?.checksum.length, 64);

  const initialRecovery = await db.recoverPendingTransactionLogsFromWal();
  assert.deepEqual(initialRecovery, []);

  const dangling = createTransactionLogRecord({
    txnId: "txn_dangling_001",
    at: Date.now(),
    writeSet: [
      {
        table: "wal_t",
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

  await appendFile(walPath, "not-json\n", "utf8");

  const recovered = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.txnId, dangling.txnId);
} finally {
  await rm(walDir, { recursive: true, force: true });
}

console.log("ok: G-STOR-007 WAL persistence and recovery entry");
