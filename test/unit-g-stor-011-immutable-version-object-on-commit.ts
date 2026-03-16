import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE dur_vobj (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO dur_vobj (id, v) VALUES (1, 10)");

await db.execute("BEGIN");
await db.execute("UPDATE dur_vobj SET v = 11 WHERE id = 1");
await db.execute("COMMIT");

const historyAfterFirstCommit = db.getTableVersionObjects("dur_vobj");
assert.equal(historyAfterFirstCommit.length, 1);
assert.equal(historyAfterFirstCommit[0]?.version, 1);
assert.equal(historyAfterFirstCommit[0]?.immutable, true);
assert.deepEqual(historyAfterFirstCommit[0]?.rows, [{ id: 1, v: 11 }]);

await db.execute("BEGIN");
await db.execute("UPDATE dur_vobj SET v = 12 WHERE id = 1");
await db.execute("COMMIT");

const historyAfterSecondCommit = db.getTableVersionObjects("dur_vobj");
assert.equal(historyAfterSecondCommit.length, 2);
assert.equal(historyAfterSecondCommit[1]?.version, 2);
assert.deepEqual(historyAfterSecondCommit[1]?.rows, [{ id: 1, v: 12 }]);

// Snapshot from version 1 remains immutable after later commits.
assert.deepEqual(historyAfterSecondCommit[0]?.rows, [{ id: 1, v: 11 }]);
assert.notEqual(historyAfterSecondCommit[0]?.objectId, historyAfterSecondCommit[1]?.objectId);
assert.notEqual(historyAfterSecondCommit[0]?.commitDigest, historyAfterSecondCommit[1]?.commitDigest);

console.log("ok: G-STOR-011 immutable version object on commit");
