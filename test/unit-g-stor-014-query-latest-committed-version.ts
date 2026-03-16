import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE dur_read (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO dur_read (id, v) VALUES (1, 10)");

await db.execute("BEGIN");
await db.execute("UPDATE dur_read SET v = 20 WHERE id = 1");

const inTxnRead = await db.query("SELECT v FROM dur_read WHERE id = 1");
assert.deepEqual(inTxnRead.rows, [{ v: 20 }]);

const latestCommittedBeforeCommit = await db.queryLatestCommitted("SELECT v FROM dur_read WHERE id = 1");
assert.deepEqual(latestCommittedBeforeCommit.rows, [{ v: 10 }]);

await db.execute("COMMIT");

const latestCommittedAfterCommit = await db.queryLatestCommitted("SELECT v FROM dur_read WHERE id = 1");
assert.deepEqual(latestCommittedAfterCommit.rows, [{ v: 20 }]);

console.log("ok: G-STOR-014 query latest committed version");
