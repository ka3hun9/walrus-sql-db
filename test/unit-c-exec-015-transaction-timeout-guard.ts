import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  transactionTimeoutMs: 10,
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE iso_timeout (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO iso_timeout (id, v) VALUES (1, 10)");

await db.execute("BEGIN");
await sleep(30);

await assert.rejects(
  db.execute("UPDATE iso_timeout SET v = 20 WHERE id = 1"),
  /ERR_TRANSACTION_STATE: .*transaction timeout exceeded \(10ms\)/,
);

assert.equal(db.getTransactionState(), "aborted");
await db.execute("ROLLBACK");
assert.equal(db.getTransactionState(), "idle");

const finalRows = await db.query("SELECT id, v FROM iso_timeout");
assert.deepEqual(finalRows.rows, [{ id: 1, v: 10 }]);

console.log("ok: C-EXEC-015 transaction timeout guard");
