import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import type { TransactionCommitBatchPayload } from "../src/types.js";

const batchCalls: TransactionCommitBatchPayload[] = [];

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  transactionCommitExecutor: async (payload) => {
    batchCalls.push(payload);
    return { digest: `digest:${payload.txnId}` };
  },
});

await db.execute("CREATE TABLE txn_batch (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO txn_batch (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO txn_batch (id, v) VALUES (2, 30)");

await db.execute("BEGIN");
await db.execute("INSERT INTO txn_batch (id, v) VALUES (3, 50)");
await db.execute("UPDATE txn_batch SET v = 20 WHERE id = 1");
await db.execute("DELETE FROM txn_batch WHERE id = 2");
await db.execute("COMMIT");

assert.equal(batchCalls.length, 1);
const payload = batchCalls[0]!;
assert.equal(payload.writeSet.length, 3);
assert.deepEqual(payload.writeSet.map((entry) => entry.op), ["INSERT", "UPDATE", "DELETE"]);
assert.equal(payload.checksum.length, 64);
assert.ok(payload.txnId.length > 0);

const committed = await db.query("SELECT id, v FROM txn_batch ORDER BY id");
assert.deepEqual(committed.rows, [
  { id: 1, v: 20 },
  { id: 3, v: 50 },
]);

console.log("ok: G-STOR-008 transaction commit batch processor");
