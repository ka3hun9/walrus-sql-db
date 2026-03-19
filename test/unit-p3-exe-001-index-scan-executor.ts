import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_exe1_users (id INT PRIMARY KEY, name TEXT, score INT, payload TEXT)");
await db.execute("CREATE INDEX idx_p3_exe1_name ON p3_exe1_users(name)");
await db.execute("CREATE INDEX idx_p3_exe1_score ON p3_exe1_users(score)");

await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (1, 'alpha', 10, 'p1')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (2, 'alphabet', 20, 'p2')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (3, 'alpine', 25, 'p3')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (4, 'beta', 30, 'p4')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (5, 'ALPACA', 35, 'p5')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (6, 'alp%literal', 40, 'p6')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (7, 'gamma', 50, 'p7')");
await db.execute("INSERT INTO p3_exe1_users (id, name, score, payload) VALUES (8, NULL, NULL, 'p8')");

const explainEq = (await db.query("EXPLAIN SELECT id FROM p3_exe1_users WHERE id = 3")).rows[0]!;
assert.equal(explainEq.physicalAccessPath, "HASH_INDEX_LOOKUP");
assert.equal(explainEq.physicalIndexStrategy, "INDEX_SCAN");

const eqRows = (await db.query("SELECT id, payload FROM p3_exe1_users WHERE id = 3")).rows;
assert.deepEqual(eqRows, [{ id: 3, payload: "p3" }]);

const explainRange = (await db.query(
  "EXPLAIN SELECT score FROM p3_exe1_users WHERE score >= 20 AND score < 40",
)).rows[0]!;
assert.equal(explainRange.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainRange.physicalIndexStrategy, "INDEX_SCAN");

const rangeRows = (await db.query(
  "SELECT id FROM p3_exe1_users WHERE score >= 20 AND score < 40 ORDER BY id ASC",
)).rows;
assert.deepEqual(rangeRows, [{ id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);

const explainPrefix = (await db.query(
  "EXPLAIN SELECT name FROM p3_exe1_users WHERE name LIKE 'alp%'",
)).rows[0]!;
assert.equal(explainPrefix.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainPrefix.physicalIndexStrategy, "INDEX_SCAN");

const prefixRows = (await db.query(
  "SELECT id FROM p3_exe1_users WHERE name LIKE 'alp%' ORDER BY id ASC",
)).rows;
assert.deepEqual(prefixRows, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 5 }, { id: 6 }]);

const explainEscapedPrefix = (await db.query(
  "EXPLAIN SELECT name FROM p3_exe1_users WHERE name LIKE 'alp#%%' ESCAPE '#'",
)).rows[0]!;
assert.equal(explainEscapedPrefix.physicalAccessPath, "BTREE_INDEX_LOOKUP");
assert.equal(explainEscapedPrefix.physicalIndexStrategy, "INDEX_SCAN");

const escapedPrefixRows = (await db.query(
  "SELECT id FROM p3_exe1_users WHERE name LIKE 'alp#%%' ESCAPE '#' ORDER BY id ASC",
)).rows;
assert.deepEqual(escapedPrefixRows, [{ id: 6 }]);

console.log("ok: P3-EXE-001 index scan executor (equality/range/prefix)");
