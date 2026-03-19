import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_test4_users (id INT PRIMARY KEY, region TEXT, quota INT)");
await db.execute("CREATE TABLE p3_test4_orders (id INT PRIMARY KEY, user_id INT, region TEXT, amount INT, status TEXT)");

await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (1, 'APAC', 60)");
await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (2, 'APAC', 55)");
await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (3, 'EU', 75)");
await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (4, 'EU', 45)");
await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (5, 'LATAM', 90)");
await db.execute("INSERT INTO p3_test4_users (id, region, quota) VALUES (6, 'LATAM', 30)");

await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (10, 1, 'APAC', 90, 'paid')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (11, 1, 'APAC', 40, 'draft')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (12, 2, 'APAC', 55, 'paid')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (13, 3, 'EU', 75, 'paid')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (14, 3, 'EU', 20, 'refund')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (15, 4, 'EU', 45, 'draft')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (16, 5, 'LATAM', 95, 'paid')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (17, 5, 'LATAM', 85, 'paid')");
await db.execute("INSERT INTO p3_test4_orders (id, user_id, region, amount, status) VALUES (18, 6, 'LATAM', 30, 'draft')");

const scalarSubquery = "SELECT MAX(amount) FROM p3_test4_orders WHERE p3_test4_orders.user_id = outer.id";
const scalarRows = await db.query(`SELECT id FROM p3_test4_users WHERE quota < (${scalarSubquery}) ORDER BY id`);
assert.deepEqual(scalarRows.rows.map((r) => r.id), [1, 5]);

const existsSubquery = "SELECT 1 FROM p3_test4_orders WHERE p3_test4_orders.user_id = outer.id AND amount >= 80";
const existsRows = await db.query(`SELECT id FROM p3_test4_users WHERE EXISTS (${existsSubquery}) ORDER BY id`);
assert.deepEqual(existsRows.rows.map((r) => r.id), [1, 5]);

const inRows = await db.query(
  "SELECT id FROM p3_test4_users WHERE id IN (SELECT user_id FROM p3_test4_orders WHERE status = 'paid') ORDER BY id",
);
assert.deepEqual(inRows.rows.map((r) => r.id), [1, 2, 3, 5]);

const correlatedInSubquery =
  "SELECT user_id FROM p3_test4_orders WHERE p3_test4_orders.region = outer.region AND status = 'paid'";
const correlatedInRows = await db.query(
  `SELECT id FROM p3_test4_users WHERE id IN (${correlatedInSubquery}) ORDER BY id`,
);
assert.deepEqual(correlatedInRows.rows.map((r) => r.id), [1, 2, 3, 5]);

const combinedRows = await db.query(
  `SELECT id
   FROM p3_test4_users
   WHERE id IN (SELECT user_id FROM p3_test4_orders WHERE status = 'paid')
     AND EXISTS (${existsSubquery})
     AND quota < (${scalarSubquery})
   ORDER BY id`,
);
assert.deepEqual(combinedRows.rows.map((r) => r.id), [1, 5]);

const existsStats = db.getSubqueryExecutionStats(existsSubquery)[0];
assert.ok(existsStats);
assert.ok((existsStats?.correlatedExecutions ?? 0) > 0);

const scalarStats = db.getSubqueryExecutionStats(scalarSubquery)[0];
assert.ok(scalarStats);
assert.ok((scalarStats?.correlatedExecutions ?? 0) > 0);

console.log("ok: integration P3-TEST-004 complex subquery coverage (scalar/correlated/EXISTS/IN)");
