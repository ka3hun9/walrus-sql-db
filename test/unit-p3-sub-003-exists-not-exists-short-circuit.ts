import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_sub3_users (id INT PRIMARY KEY, flag INT)");
await db.execute("CREATE TABLE p3_sub3_orders (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO p3_sub3_users (id, flag) VALUES (1, 0)");
await db.execute("INSERT INTO p3_sub3_users (id, flag) VALUES (2, 0)");
await db.execute("INSERT INTO p3_sub3_users (id, flag) VALUES (3, 0)");

await db.execute("INSERT INTO p3_sub3_orders (id, user_id, amount) VALUES (10, 1, 90)");
await db.execute("INSERT INTO p3_sub3_orders (id, user_id, amount) VALUES (11, 1, 10)");
await db.execute("INSERT INTO p3_sub3_orders (id, user_id, amount) VALUES (12, 2, 50)");
await db.execute("INSERT INTO p3_sub3_orders (id, user_id, amount) VALUES (13, 9, 5)");

const existsSubquery = "SELECT 1 FROM p3_sub3_orders WHERE p3_sub3_orders.user_id = outer.id AND amount >= 50";
const existsRows = await db.query(`SELECT id FROM p3_sub3_users WHERE EXISTS (${existsSubquery}) ORDER BY id`);
assert.deepEqual(existsRows.rows.map((r) => r.id), [1, 2]);

const notExistsRows = await db.query(`SELECT id FROM p3_sub3_users WHERE NOT EXISTS (${existsSubquery}) ORDER BY id`);
assert.deepEqual(notExistsRows.rows.map((r) => r.id), [3]);

await db.execute(`UPDATE p3_sub3_users SET flag = 7 WHERE NOT EXISTS (${existsSubquery})`);
const updatedFlags = await db.query("SELECT id, flag FROM p3_sub3_users ORDER BY id");
assert.deepEqual(updatedFlags.rows.map((r) => [r.id, r.flag]), [
  [1, 0],
  [2, 0],
  [3, 7],
]);

const nonCorrelatedExists = await db.query(
  "SELECT id FROM p3_sub3_users WHERE EXISTS (SELECT 1 FROM p3_sub3_orders WHERE amount >= 90) ORDER BY id",
);
assert.deepEqual(nonCorrelatedExists.rows.map((r) => r.id), [1, 2, 3]);

const nonCorrelatedNotExists = await db.query(
  "SELECT id FROM p3_sub3_users WHERE NOT EXISTS (SELECT 1 FROM p3_sub3_orders WHERE amount >= 900) ORDER BY id",
);
assert.deepEqual(nonCorrelatedNotExists.rows.map((r) => r.id), [1, 2, 3]);

const shortCircuitSubquery = "SELECT id FROM p3_sub3_orders WHERE p3_sub3_orders.user_id = outer.id";
const shortCircuitRows = await db.query(`SELECT id FROM p3_sub3_users WHERE EXISTS (${shortCircuitSubquery}) ORDER BY id`);
assert.deepEqual(shortCircuitRows.rows.map((r) => r.id), [1, 2]);

const shortCircuitStats = db.getSubqueryExecutionStats(shortCircuitSubquery)[0];
assert.ok(shortCircuitStats);
assert.equal(shortCircuitStats!.executions, 3);
assert.equal(shortCircuitStats!.correlatedExecutions, 3);
assert.equal(shortCircuitStats!.cacheMisses, 3);
assert.equal(shortCircuitStats!.cacheHits, 0);
assert.equal(shortCircuitStats!.rowsScanned, 8);
assert.equal(shortCircuitStats!.rowsReturned, 2);
assert.equal(shortCircuitStats!.budgetExceededCount, 0);

console.log("ok: P3-SUB-003 EXISTS/NOT EXISTS semantics and short-circuit optimization");
