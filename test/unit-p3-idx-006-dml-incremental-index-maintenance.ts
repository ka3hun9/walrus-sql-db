import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_dml_users (id INT PRIMARY KEY, score INT, email TEXT)");
await db.execute("CREATE INDEX idx_dml_score ON idx_dml_users(score)");
db.flushStorageWriteLog("idx_dml_users");

await db.execute("INSERT INTO idx_dml_users (id, score, email) VALUES (1, 10, 'u1')");
await db.execute("INSERT INTO idx_dml_users (id, score, email) VALUES (2, 20, 'u2')");
await db.execute("UPDATE idx_dml_users SET score = 30 WHERE id = 1");
await db.execute("DELETE FROM idx_dml_users WHERE id = 2");

{
  const btreeStats = db.getBtreeIndexStats("idx_dml_users");
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.rowsIndexed, 1);

  const hashStats = db.getHashIndexStats("idx_dml_users");
  assert.equal(hashStats.length, 1);
  assert.equal(hashStats[0]?.rowsIndexed, 1);

  const log = db.getStorageWriteLog("idx_dml_users");
  assert.ok(!log.some((evt) => evt.op === "INDEX_REBUILD"));
}

{
  const rows = (await db.query("SELECT id, score FROM idx_dml_users WHERE score = 30")).rows;
  assert.deepEqual(rows, [{ id: 1, score: 30 }]);
}

db.flushStorageWriteLog("idx_dml_users");

await db.execute("BEGIN");
await db.execute("INSERT INTO idx_dml_users (id, score, email) VALUES (3, 15, 'u3')");
await db.execute("UPDATE idx_dml_users SET score = 35 WHERE id = 1");
await db.execute("DELETE FROM idx_dml_users WHERE id = 3");
await db.execute("COMMIT");

{
  const btreeStats = db.getBtreeIndexStats("idx_dml_users");
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.rowsIndexed, 1);

  const hashStats = db.getHashIndexStats("idx_dml_users");
  assert.equal(hashStats.length, 1);
  assert.equal(hashStats[0]?.rowsIndexed, 1);

  const log = db.getStorageWriteLog("idx_dml_users");
  assert.ok(!log.some((evt) => evt.op === "INDEX_REBUILD"));
}

{
  const rows = (await db.query("SELECT id, score FROM idx_dml_users WHERE score = 35 ORDER BY id ASC")).rows;
  assert.deepEqual(rows, [{ id: 1, score: 35 }]);
}

console.log("ok: P3-IDX-006 dml incremental index maintenance");
