import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const table = "p3_test1_users";
const scoreIndex = "idx_p3_test1_score";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute(`CREATE TABLE ${table} (id INT PRIMARY KEY, email TEXT UNIQUE, score INT, name TEXT)`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (1, 'u1@x.com', 10, 'u1')`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (2, 'u2@x.com', 20, 'u2')`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (3, 'u3@x.com', 30, 'u3')`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (4, 'u4@x.com', 40, 'u4')`);
await db.execute(`CREATE INDEX ${scoreIndex} ON ${table}(score)`);

const catalog = db.getIndexCatalog(table);
const emailHashIndex = catalog.find((entry) =>
  entry.type === "HASH" && entry.columns.length === 1 && entry.columns[0]?.toUpperCase() === "EMAIL"
);
const btreeCatalog = catalog.find((entry) => entry.name.toUpperCase() === scoreIndex.toUpperCase());
assert.ok(emailHashIndex);
assert.ok(btreeCatalog);
assert.equal(btreeCatalog?.type, "BTREE");
assert.equal(btreeCatalog?.status, "ACTIVE");

{
  const hashStats = db.getHashIndexStats(table);
  assert.equal(hashStats.length, 1);
  assert.equal(hashStats[0]?.keys, 8);
  assert.equal(hashStats[0]?.rowsIndexed, 8);

  const btreeStats = db.getBtreeIndexStats(table);
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.keys, 4);
  assert.equal(btreeStats[0]?.rowsIndexed, 4);

}

db.flushStorageWriteLog(table);

await db.execute(`UPDATE ${table} SET score = 35 WHERE id = 2`);
await db.execute(`UPDATE ${table} SET email = 'u2n@x.com' WHERE id = 2`);
await db.execute(`DELETE FROM ${table} WHERE id = 1`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (5, 'u5@x.com', 25, 'u5')`);

{
  const oldEmail = (await db.query(`SELECT id FROM ${table} WHERE email = 'u2@x.com'`)).rows;
  assert.equal(oldEmail.length, 0);

  const newEmail = (await db.query(`SELECT id, score FROM ${table} WHERE email = 'u2n@x.com'`)).rows;
  assert.deepEqual(newEmail, [{ id: 2, score: 35 }]);

  const scoreOrdered = (await db.query(`SELECT id FROM ${table} WHERE score >= 25 ORDER BY score ASC`)).rows;
  assert.deepEqual(scoreOrdered.map((row) => row.id), [5, 3, 2, 4]);

  const hashStats = db.getHashIndexStats(table);
  assert.equal(hashStats.length, 1);
  assert.equal(hashStats[0]?.keys, 8);
  assert.equal(hashStats[0]?.rowsIndexed, 8);

  const btreeStats = db.getBtreeIndexStats(table);
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.keys, 4);
  assert.equal(btreeStats[0]?.rowsIndexed, 4);

}

const beforeRollbackRows = (await db.query(`SELECT id, email, score FROM ${table} ORDER BY id ASC`)).rows;
const beforeRollbackHash = db.getHashIndexStats(table)[0];
const beforeRollbackBtree = db.getBtreeIndexStats(table)[0];
assert.ok(beforeRollbackHash);
assert.ok(beforeRollbackBtree);

await db.execute("BEGIN");
await db.execute(`UPDATE ${table} SET score = 70 WHERE id = 5`);
await db.execute(`UPDATE ${table} SET email = 'u5tmp@x.com' WHERE id = 5`);
await db.execute(`DELETE FROM ${table} WHERE id = 2`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (7, 'u7@x.com', 50, 'u7')`);
await db.execute("ROLLBACK");

{
  const afterRollbackRows = (await db.query(`SELECT id, email, score FROM ${table} ORDER BY id ASC`)).rows;
  assert.deepEqual(afterRollbackRows, beforeRollbackRows);

  const afterRollbackHash = db.getHashIndexStats(table)[0];
  const afterRollbackBtree = db.getBtreeIndexStats(table)[0];
  assert.deepEqual(afterRollbackHash, beforeRollbackHash);
  assert.deepEqual(afterRollbackBtree, beforeRollbackBtree);
}

await db.execute("BEGIN");
await db.execute(`UPDATE ${table} SET score = 99 WHERE id = 3`);
await db.execute(`UPDATE ${table} SET email = 'u3n@x.com' WHERE id = 3`);
await db.execute(`DELETE FROM ${table} WHERE id = 4`);
await db.execute(`INSERT INTO ${table} (id, email, score, name) VALUES (6, 'u6@x.com', 45, 'u6')`);
await db.execute("COMMIT");

{
  const rows = (await db.query(`SELECT id, score FROM ${table} ORDER BY score ASC`)).rows;
  assert.deepEqual(rows.map((row) => row.id), [5, 2, 6, 3]);

  const oldEmail = (await db.query(`SELECT id FROM ${table} WHERE email = 'u3@x.com'`)).rows;
  assert.equal(oldEmail.length, 0);
  const newEmail = (await db.query(`SELECT id, score FROM ${table} WHERE email = 'u3n@x.com'`)).rows;
  assert.deepEqual(newEmail, [{ id: 3, score: 99 }]);

  const hashStats = db.getHashIndexStats(table);
  assert.equal(hashStats.length, 1);
  assert.equal(hashStats[0]?.keys, 8);
  assert.equal(hashStats[0]?.rowsIndexed, 8);

  const btreeStats = db.getBtreeIndexStats(table);
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.keys, 4);
  assert.equal(btreeStats[0]?.rowsIndexed, 4);
}

const scoreHistory = db.getIndexVersionObjects(scoreIndex);
assert.ok(Array.isArray(scoreHistory));
assert.equal(scoreHistory.length, 2);

const latestScore = scoreHistory[scoreHistory.length - 1];
assert.ok(latestScore);
assert.equal(latestScore?.indexType, "BTREE");
assert.equal(latestScore?.payload.indexType, "BTREE");
assert.equal(latestScore?.keyCount, 4);
assert.equal(latestScore?.rowCount, 4);
if (latestScore?.payload.indexType === "BTREE") {
  assert.deepEqual(latestScore.payload.entries.map((entry) => entry.key), [25, 35, 45, 99]);
  assert.ok(latestScore.payload.entries.every((entry) => entry.rowKeys.length === 1));
  assert.ok(latestScore.payload.entries.every((entry) => typeof entry.rowKeys[0] === "string"));
}

const emailHistory = db.getIndexVersionObjects(emailHashIndex!.name);
assert.ok(Array.isArray(emailHistory));
assert.equal(emailHistory.length, 1);

const latestEmail = emailHistory[emailHistory.length - 1];
assert.ok(latestEmail);
assert.equal(latestEmail?.indexType, "HASH");
assert.equal(latestEmail?.payload.indexType, "HASH");
assert.equal(latestEmail?.keyCount, 4);
assert.equal(latestEmail?.rowCount, 4);
if (latestEmail?.payload.indexType === "HASH") {
  assert.equal(latestEmail.payload.buckets.length, 4);
  assert.ok(latestEmail.payload.buckets.every((bucket) => bucket.rowKeys.length === 1));
  assert.ok(latestEmail.payload.buckets.every((bucket) => typeof bucket.rowKeys[0] === "string"));
}

console.log("ok: P3-TEST-001 index structure correctness and update consistency");
