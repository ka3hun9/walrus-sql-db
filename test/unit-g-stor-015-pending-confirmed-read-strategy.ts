import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
  transactionCommitExecutor: async () => ({ digest: "ok-digest" }),
});

await db.execute("CREATE TABLE dur_confirm (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO dur_confirm (id, v) VALUES (1, 10)");

await db.execute("BEGIN");
await db.execute("UPDATE dur_confirm SET v = 11 WHERE id = 1");
await db.execute("COMMIT");

const firstHistory = db.getTableVersionObjects("dur_confirm");
assert.equal(firstHistory.length, 1);
assert.equal(firstHistory[0]?.confirmationStatus, "pending");

const confirmedV1 = db.confirmVersionObject("dur_confirm", 1);
assert.equal(confirmedV1?.confirmationStatus, "confirmed");

await db.execute("BEGIN");
await db.execute("UPDATE dur_confirm SET v = 12 WHERE id = 1");
await db.execute("COMMIT");

const pendingRead = await db.queryByConfirmation("SELECT v FROM dur_confirm WHERE id = 1", "pending");
assert.deepEqual(pendingRead.rows, [{ v: 12 }]);

const confirmedRead = await db.queryByConfirmation("SELECT v FROM dur_confirm WHERE id = 1", "confirmed");
assert.deepEqual(confirmedRead.rows, [{ v: 11 }]);

const confirmLatest = db.confirmVersionObject("dur_confirm");
assert.equal(confirmLatest?.currentVersion, 2);
assert.equal(confirmLatest?.confirmationStatus, "confirmed");

const confirmedAfterConfirm = await db.queryByConfirmation("SELECT v FROM dur_confirm WHERE id = 1", "confirmed");
assert.deepEqual(confirmedAfterConfirm.rows, [{ v: 12 }]);

console.log("ok: G-STOR-015 pending/confirmed read strategy");
