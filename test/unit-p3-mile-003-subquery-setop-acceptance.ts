import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_mile3_users (id INT PRIMARY KEY, region TEXT, quota INT)");
await db.execute("CREATE TABLE p3_mile3_orders (id INT PRIMARY KEY, user_id INT, amount INT, status TEXT)");
await db.execute("CREATE TABLE p3_mile3_set_left (id INT)");
await db.execute("CREATE TABLE p3_mile3_set_right (id INT)");

await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (1, 'APAC', 60)");
await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (2, 'APAC', 55)");
await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (3, 'EU', 75)");
await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (4, 'EU', 45)");
await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (5, 'LATAM', 90)");
await db.execute("INSERT INTO p3_mile3_users (id, region, quota) VALUES (6, 'LATAM', 30)");

await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (10, 1, 90, 'paid')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (11, 1, 40, 'draft')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (12, 2, 55, 'paid')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (13, 3, 75, 'paid')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (14, 3, 20, 'refund')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (15, 4, 45, 'draft')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (16, 5, 95, 'paid')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (17, 5, 85, 'paid')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (18, 6, 30, 'draft')");
await db.execute("INSERT INTO p3_mile3_orders (id, user_id, amount, status) VALUES (19, NULL, 99, 'paid')");

for (const value of [1, 2, 2, 3, 5]) {
  await db.execute(`INSERT INTO p3_mile3_set_left (id) VALUES (${value})`);
}
for (const value of [2, 2, 4, 5, 5]) {
  await db.execute(`INSERT INTO p3_mile3_set_right (id) VALUES (${value})`);
}

const scalarSubquery = "SELECT MAX(amount) FROM p3_mile3_orders WHERE p3_mile3_orders.user_id = outer.id";
const scalarRows = await db.query(`SELECT id FROM p3_mile3_users WHERE quota < (${scalarSubquery}) ORDER BY id`);
assert.deepEqual(scalarRows.rows.map((row) => row.id), [1, 5]);

const existsSubquery = "SELECT 1 FROM p3_mile3_orders WHERE p3_mile3_orders.user_id = outer.id AND amount >= 80";
const existsRows = await db.query(`SELECT id FROM p3_mile3_users WHERE EXISTS (${existsSubquery}) ORDER BY id`);
assert.deepEqual(existsRows.rows.map((row) => row.id), [1, 5]);

const inRows = await db.query(
  "SELECT id FROM p3_mile3_users WHERE id IN (SELECT user_id FROM p3_mile3_orders WHERE status = 'paid') ORDER BY id",
);
assert.deepEqual(inRows.rows.map((row) => row.id), [1, 2, 3, 5]);

const notInWithNullRows = await db.query(
  "SELECT id FROM p3_mile3_users WHERE id NOT IN (SELECT user_id FROM p3_mile3_orders WHERE status = 'paid') ORDER BY id",
);
assert.deepEqual(notInWithNullRows.rows.map((row) => row.id), []);

const notInWithoutNullRows = await db.query(
  "SELECT id FROM p3_mile3_users WHERE id NOT IN (SELECT user_id FROM p3_mile3_orders WHERE status = 'paid' AND user_id IS NOT NULL) ORDER BY id",
);
assert.deepEqual(notInWithoutNullRows.rows.map((row) => row.id), [4, 6]);

const scalarStats = db.getSubqueryExecutionStats(scalarSubquery)[0];
assert.ok(scalarStats);
assert.ok((scalarStats?.correlatedExecutions ?? 0) > 0);

const existsStats = db.getSubqueryExecutionStats(existsSubquery)[0];
assert.ok(existsStats);
assert.ok((existsStats?.correlatedExecutions ?? 0) > 0);

const unionDistinct = await db.query(
  "SELECT id FROM p3_mile3_set_left UNION SELECT id FROM p3_mile3_set_right ORDER BY id ASC",
);
assert.deepEqual(unionDistinct.rows.map((row) => row.id), [1, 2, 3, 4, 5]);

const unionAll = await db.query(
  "SELECT id FROM p3_mile3_set_left UNION ALL SELECT id FROM p3_mile3_set_right ORDER BY id ASC",
);
assert.deepEqual(unionAll.rows.map((row) => row.id), [1, 2, 2, 2, 2, 3, 4, 5, 5, 5]);

const intersectAll = await db.query(
  "SELECT id FROM p3_mile3_set_left INTERSECT ALL SELECT id FROM p3_mile3_set_right ORDER BY id ASC",
);
assert.deepEqual(intersectAll.rows.map((row) => row.id), [2, 2, 5]);

const exceptAll = await db.query(
  "SELECT id FROM p3_mile3_set_left EXCEPT ALL SELECT id FROM p3_mile3_set_right ORDER BY id ASC",
);
assert.deepEqual(exceptAll.rows.map((row) => row.id), [1, 3]);

const fullPathRows = await db.query(
  `SELECT id FROM p3_mile3_users WHERE id IN (SELECT user_id FROM p3_mile3_orders WHERE amount >= 80)
   UNION ALL
   SELECT id FROM p3_mile3_users WHERE EXISTS (SELECT 1 FROM p3_mile3_orders WHERE p3_mile3_orders.user_id = outer.id AND amount >= 50)
   EXCEPT ALL
   SELECT id FROM p3_mile3_users WHERE id NOT IN (
     SELECT user_id FROM p3_mile3_orders WHERE status = 'paid' AND user_id IS NOT NULL
   )
   ORDER BY id ASC
   LIMIT 4
   OFFSET 1`,
);
assert.deepEqual(fullPathRows.rows.map((row) => row.id), [1, 2, 3, 5]);

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-003\b/.test(checklist), false, "P3-MILE-003 must be checked");

const report = readFileSync("docs/sql-p3-mile-003-subquery-set-operation-acceptance-report.md", "utf8");
assert.ok(report.includes("## P3-MILE-003"));
assert.ok(report.includes("subquery"));
assert.ok(report.includes("UNION ALL"));
assert.ok(report.includes("EXCEPT ALL"));
assert.ok(report.includes("PASS"));

console.log("ok: P3-MILE-003 subquery + set-operation full-path acceptance");
