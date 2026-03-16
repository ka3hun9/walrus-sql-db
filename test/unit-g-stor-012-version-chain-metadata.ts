import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE dur_chain (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO dur_chain (id, v) VALUES (1, 1)");

await db.execute("BEGIN");
await db.execute("UPDATE dur_chain SET v = 2 WHERE id = 1");
await db.execute("COMMIT");

await db.execute("BEGIN");
await db.execute("UPDATE dur_chain SET v = 3 WHERE id = 1");
await db.execute("COMMIT");

const history = db.getTableVersionObjects("dur_chain");
assert.equal(history.length, 2);

assert.equal(history[0]?.prevVersion, null);
assert.equal(history[0]?.currentVersion, 1);
assert.equal(history[0]?.version, 1);
assert.equal(history[0]?.commitDigest.length, 64);

assert.equal(history[1]?.prevVersion, 1);
assert.equal(history[1]?.currentVersion, 2);
assert.equal(history[1]?.version, 2);
assert.equal(history[1]?.commitDigest.length, 64);

assert.notEqual(history[0]?.commitDigest, history[1]?.commitDigest);

console.log("ok: G-STOR-012 version chain metadata");
