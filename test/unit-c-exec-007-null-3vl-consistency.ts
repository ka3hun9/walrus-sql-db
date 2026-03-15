import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_3vl (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_3vl (id, v) VALUES (1, NULL)");
await db.execute("INSERT INTO t_3vl (id, v) VALUES (2, 1)");
await db.execute("INSERT INTO t_3vl (id, v) VALUES (3, 2)");

const filterEqNull = await db.query("SELECT id FROM t_3vl WHERE v = NULL ORDER BY id");
assert.equal(filterEqNull.rows.length, 0);

const filterNotEq = await db.query("SELECT id FROM t_3vl WHERE NOT (v = 1) ORDER BY id");
assert.deepEqual(filterNotEq.rows.map((r) => r.id), [3]);

await db.execute("CREATE TABLE a_3vl (id INT PRIMARY KEY, k INT)");
await db.execute("CREATE TABLE b_3vl (id INT PRIMARY KEY, k INT)");
await db.execute("INSERT INTO a_3vl (id, k) VALUES (1, 1)");
await db.execute("INSERT INTO a_3vl (id, k) VALUES (2, NULL)");
await db.execute("INSERT INTO a_3vl (id, k) VALUES (3, 2)");
await db.execute("INSERT INTO b_3vl (id, k) VALUES (10, 1)");
await db.execute("INSERT INTO b_3vl (id, k) VALUES (11, NULL)");
await db.execute("INSERT INTO b_3vl (id, k) VALUES (12, 3)");

const inner = await db.query("SELECT a_3vl.id, b_3vl.id FROM a_3vl INNER JOIN b_3vl ON a_3vl.k = b_3vl.k");
assert.deepEqual(inner.rows.map((r) => [r["a_3vl.id"], r["b_3vl.id"]]), [[1, 10]]);

const left = await db.query("SELECT a_3vl.id, b_3vl.id FROM a_3vl LEFT JOIN b_3vl ON a_3vl.k = b_3vl.k ORDER BY a_3vl.id");
assert.deepEqual(
  left.rows.map((r) => [r["a_3vl.id"], r["b_3vl.id"]]),
  [
    [1, 10],
    [2, null],
    [3, null],
  ],
);

const sum = await db.query("SELECT SUM(v) FROM t_3vl");
assert.equal(sum.rows[0]!.sum, 3);
const avg = await db.query("SELECT AVG(v) FROM t_3vl");
assert.equal(avg.rows[0]!.avg, 1.5);

console.log("ok: C-EXEC-007 NULL 3VL consistency in filter/join/aggregate");
