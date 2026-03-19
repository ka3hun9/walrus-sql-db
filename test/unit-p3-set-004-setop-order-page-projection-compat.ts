import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_set4_left (id INT, score INT)");
await db.execute("CREATE TABLE p3_set4_right (id INT, score INT)");

await db.execute("INSERT INTO p3_set4_left (id, score) VALUES (1, 10)");
await db.execute("INSERT INTO p3_set4_left (id, score) VALUES (2, 20)");
await db.execute("INSERT INTO p3_set4_left (id, score) VALUES (2, 20)");
await db.execute("INSERT INTO p3_set4_left (id, score) VALUES (3, 30)");
await db.execute("INSERT INTO p3_set4_left (id, score) VALUES (4, 40)");

await db.execute("INSERT INTO p3_set4_right (id, score) VALUES (2, 20)");
await db.execute("INSERT INTO p3_set4_right (id, score) VALUES (2, 20)");
await db.execute("INSERT INTO p3_set4_right (id, score) VALUES (2, 20)");
await db.execute("INSERT INTO p3_set4_right (id, score) VALUES (3, 30)");
await db.execute("INSERT INTO p3_set4_right (id, score) VALUES (5, 50)");

const projectionCompatibility = await db.query(
  "SELECT id AS key_id, score AS metric FROM p3_set4_left WHERE id <= 2 UNION ALL SELECT score AS x, id AS y FROM p3_set4_right WHERE id <= 3 ORDER BY key_id ASC, metric ASC",
);
assert.deepEqual(projectionCompatibility.rows, [
  { key_id: 1, metric: 10 },
  { key_id: 2, metric: 20 },
  { key_id: 2, metric: 20 },
  { key_id: 20, metric: 2 },
  { key_id: 20, metric: 2 },
  { key_id: 20, metric: 2 },
  { key_id: 30, metric: 3 },
]);

const unionPaged = await db.query(
  "SELECT id AS key_id FROM p3_set4_left UNION SELECT id AS x FROM p3_set4_right ORDER BY key_id ASC LIMIT 3 OFFSET 1",
);
assert.deepEqual(unionPaged.rows.map((r) => r.key_id), [2, 3, 4]);

const intersectAllPaged = await db.query(
  "SELECT id AS key_id FROM p3_set4_left INTERSECT ALL SELECT id AS x FROM p3_set4_right ORDER BY key_id DESC LIMIT 2 OFFSET 0",
);
assert.deepEqual(intersectAllPaged.rows.map((r) => r.key_id), [3, 2]);

const exceptAllPaged = await db.query(
  "SELECT id AS key_id FROM p3_set4_left EXCEPT ALL SELECT id AS x FROM p3_set4_right ORDER BY key_id DESC LIMIT 1 OFFSET 1",
);
assert.deepEqual(exceptAllPaged.rows.map((r) => r.key_id), [1]);

const chainedMixedTail = await db.query(
  "SELECT id AS out_id FROM p3_set4_left WHERE id <= 3 UNION ALL SELECT id AS z FROM p3_set4_right WHERE id >= 3 EXCEPT SELECT id FROM p3_set4_right WHERE id = 3 ORDER BY out_id ASC LIMIT 4 OFFSET 1",
);
assert.deepEqual(chainedMixedTail.rows.map((r) => r.out_id), [2, 5]);

console.log("ok: P3-SET-004 set-op order/page/projection compatibility");
