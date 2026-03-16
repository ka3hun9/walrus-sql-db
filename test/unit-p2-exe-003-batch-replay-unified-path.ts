import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";
import type { TransactionCommitBatchPayload } from "../src/types.js";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-exe-003-"));
const walPath = join(walDir, "txn.wal.ndjson");

let attempts = 0;
const payloads: TransactionCommitBatchPayload[] = [];

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    wal: { enabled: true, filePath: walPath },
    transactionCommitExecutor: async (payload) => {
      payloads.push(payload);
      attempts += 1;
      if (attempts === 2) throw new Error("bridge transient error");
      return { digest: `ok-${attempts}` };
    },
  });

  await db.execute("CREATE TABLE exe003_t (id INT PRIMARY KEY, v INT)");

  await db.execute("BEGIN");
  await db.execute("INSERT INTO exe003_t (id, v) VALUES (1, 10)");
  await db.execute("COMMIT");

  await db.execute("BEGIN");
  await db.execute("INSERT INTO exe003_t (id, v) VALUES (2, 20)");
  await assert.rejects(
    db.execute("COMMIT"),
    /ERR_EXECUTION_FAILED: execute\(\) failed: bridge transient error/,
  );

  const pending = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(pending.length, 1);

  const replay = await db.replayPendingTransactionLogsFromWal();
  assert.deepEqual(replay.failedTxnIds, []);
  assert.deepEqual(replay.replayedTxnIds, [pending[0]!.txnId]);

  assert.equal(payloads.length, 3);
  const directPayload = payloads[0]!;
  const failedPayload = payloads[1]!;
  const replayPayload = payloads[2]!;

  assert.equal(directPayload.writeSet.length, 1);
  assert.equal(directPayload.writeSet[0]!.op, "INSERT");
  assert.equal(failedPayload.txnId, replayPayload.txnId);
  assert.deepEqual(failedPayload.writeSet, replayPayload.writeSet);
  assert.equal(failedPayload.checksum, replayPayload.checksum);
} finally {
  await rm(walDir, { recursive: true, force: true });
}

console.log("ok: P2-EXE-003 batch commit and replay share prepared-record path");
