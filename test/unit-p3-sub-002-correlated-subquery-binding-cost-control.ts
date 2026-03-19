import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_sub2_users (id INT PRIMARY KEY, region TEXT, flag INT)");
await db.execute("CREATE TABLE p3_sub2_orders (id INT PRIMARY KEY, user_id INT, region TEXT, amount INT, note TEXT)");

await db.execute("INSERT INTO p3_sub2_users (id, region, flag) VALUES (1, 'APAC', 0)");
await db.execute("INSERT INTO p3_sub2_users (id, region, flag) VALUES (2, 'APAC', 0)");
await db.execute("INSERT INTO p3_sub2_users (id, region, flag) VALUES (3, 'EU', 0)");
await db.execute("INSERT INTO p3_sub2_users (id, region, flag) VALUES (4, 'EU', 0)");
await db.execute("INSERT INTO p3_sub2_users (id, region, flag) VALUES (5, 'LATAM', 0)");

await db.execute("INSERT INTO p3_sub2_orders (id, user_id, region, amount, note) VALUES (10, 1, 'APAC', 80, 'outer.id')");
await db.execute("INSERT INTO p3_sub2_orders (id, user_id, region, amount, note) VALUES (11, 2, 'APAC', 40, 'outer.id')");
await db.execute("INSERT INTO p3_sub2_orders (id, user_id, region, amount, note) VALUES (12, 3, 'EU', 90, 'literal')");
await db.execute("INSERT INTO p3_sub2_orders (id, user_id, region, amount, note) VALUES (13, 9, 'LATAM', 20, 'literal')");

const literalSubquery = "SELECT 1 FROM p3_sub2_orders WHERE note = 'outer.id' AND user_id = outer.id";
const literalRows = await db.query(`SELECT id FROM p3_sub2_users WHERE EXISTS (${literalSubquery}) ORDER BY id`);
assert.deepEqual(literalRows.rows.map((r) => r.id), [1, 2]);

await db.execute(`UPDATE p3_sub2_users SET flag = 7 WHERE EXISTS (${literalSubquery})`);
const updatedFlags = await db.query("SELECT id, flag FROM p3_sub2_users ORDER BY id");
assert.deepEqual(updatedFlags.rows.map((r) => [r.id, r.flag]), [
  [1, 7],
  [2, 7],
  [3, 0],
  [4, 0],
  [5, 0],
]);

const costSubquery = "SELECT 1 FROM p3_sub2_orders WHERE p3_sub2_orders.region = outer.region AND amount >= 50";
const costRows = await db.query(`SELECT id FROM p3_sub2_users WHERE EXISTS (${costSubquery}) ORDER BY id`);
assert.deepEqual(costRows.rows.map((r) => r.id), [1, 2, 3, 4]);

const costStats = db.getSubqueryExecutionStats(costSubquery)[0];
assert.ok(costStats);
assert.equal(costStats!.executions, 5);
assert.equal(costStats!.correlatedExecutions, 5);
assert.equal(costStats!.cacheMisses, 3);
assert.equal(costStats!.cacheHits, 2);
assert.equal(costStats!.rowsScanned, 12);
assert.equal(costStats!.budgetExceededCount, 0);

console.log("ok: P3-SUB-002 correlated subquery outer binding and cost control");
