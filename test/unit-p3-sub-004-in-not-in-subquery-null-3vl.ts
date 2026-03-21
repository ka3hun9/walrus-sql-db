import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_sub4_users (id INT PRIMARY KEY, probe INT, region TEXT)");
await db.execute("CREATE TABLE p3_sub4_candidates (id INT PRIMARY KEY, user_probe INT, region TEXT)");

await db.execute("INSERT INTO p3_sub4_users (id, probe, region) VALUES (1, 1, 'APAC')");
await db.execute("INSERT INTO p3_sub4_users (id, probe, region) VALUES (2, 2, 'APAC')");
await db.execute("INSERT INTO p3_sub4_users (id, probe, region) VALUES (3, 3, 'EU')");
await db.execute("INSERT INTO p3_sub4_users (id, probe, region) VALUES (4, NULL, 'LATAM')");
await db.execute("INSERT INTO p3_sub4_users (id, probe, region) VALUES (5, 9, 'LATAM')");

await db.execute("INSERT INTO p3_sub4_candidates (id, user_probe, region) VALUES (10, 1, 'APAC')");
await db.execute("INSERT INTO p3_sub4_candidates (id, user_probe, region) VALUES (11, NULL, 'APAC')");
await db.execute("INSERT INTO p3_sub4_candidates (id, user_probe, region) VALUES (12, 3, 'EU')");
await db.execute("INSERT INTO p3_sub4_candidates (id, user_probe, region) VALUES (13, NULL, 'LATAM')");
await db.execute("INSERT INTO p3_sub4_candidates (id, user_probe, region) VALUES (14, 7, 'LATAM')");

const inRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe IN (SELECT user_probe FROM p3_sub4_candidates) ORDER BY id",
);
assert.deepEqual(inRows.rows.map((r) => r.id), [1, 3]);

const notInRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe NOT IN (SELECT user_probe FROM p3_sub4_candidates) ORDER BY id",
);
assert.deepEqual(notInRows.rows.map((r) => r.id), []);

const notInWithoutNullRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe NOT IN (SELECT user_probe FROM p3_sub4_candidates WHERE user_probe IS NOT NULL) ORDER BY id",
);
assert.deepEqual(notInWithoutNullRows.rows.map((r) => r.id), [2, 5]);

const correlatedInRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe IN (SELECT user_probe FROM p3_sub4_candidates WHERE p3_sub4_candidates.region = outer.region) ORDER BY id",
);
assert.deepEqual(correlatedInRows.rows.map((r) => r.id), [1, 3]);

const correlatedNotInRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe NOT IN (SELECT user_probe FROM p3_sub4_candidates WHERE p3_sub4_candidates.region = outer.region) ORDER BY id",
);
assert.deepEqual(correlatedNotInRows.rows.map((r) => r.id), []);

const emptyInRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe IN (SELECT user_probe FROM p3_sub4_candidates WHERE 1=0) ORDER BY id",
);
assert.deepEqual(emptyInRows.rows.map((r) => r.id), []);

const emptyNotInRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe NOT IN (SELECT user_probe FROM p3_sub4_candidates WHERE 1=0) ORDER BY id",
);
assert.deepEqual(emptyNotInRows.rows.map((r) => r.id), [1, 2, 3, 4, 5]);

const coalesceProjectionRows = await db.query(
  "SELECT id FROM p3_sub4_users WHERE probe IN (SELECT COALESCE(user_probe, -1) FROM p3_sub4_candidates) ORDER BY id",
);
assert.deepEqual(coalesceProjectionRows.rows.map((r) => r.id), [1, 3]);

let arityError: unknown = null;
try {
  await db.query(
    "SELECT id FROM p3_sub4_users WHERE probe IN (SELECT user_probe, region FROM p3_sub4_candidates WHERE 1=0)",
  );
} catch (err) {
  arityError = err;
}
assert.ok(arityError);
assert.match(String(arityError), /Subquery must return exactly 1 column/i);

await db.execute(
  "UPDATE p3_sub4_users SET region = 'NO_MATCH' WHERE probe NOT IN (SELECT user_probe FROM p3_sub4_candidates WHERE user_probe IS NOT NULL)",
);
const updated = await db.query("SELECT id, region FROM p3_sub4_users ORDER BY id");
assert.deepEqual(
  updated.rows.map((r) => [r.id, r.region]),
  [
    [1, "APAC"],
    [2, "NO_MATCH"],
    [3, "EU"],
    [4, "LATAM"],
    [5, "NO_MATCH"],
  ],
);

console.log("ok: P3-SUB-004 IN/NOT IN subquery semantics with NULL 3VL");
