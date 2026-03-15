import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_null (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_null (id, v) VALUES (1, NULL)");
await db.execute("INSERT INTO t_null (id, v) VALUES (2, 10)");
await db.execute("INSERT INTO t_null (id, v) VALUES (3, NULL)");
await db.execute("INSERT INTO t_null (id, v) VALUES (4, 20)");

const eqNull = await db.query("SELECT id FROM t_null WHERE v = NULL");
assert.equal(eqNull.rows.length, 0);
const neqNull = await db.query("SELECT id FROM t_null WHERE v <> NULL");
assert.equal(neqNull.rows.length, 0);
const isNull = await db.query("SELECT id FROM t_null WHERE v IS NULL ORDER BY id");
assert.deepEqual(
  isNull.rows.map((r) => r.id),
  [1, 3],
);

const countAll = await db.query("SELECT COUNT(*) FROM t_null");
assert.equal(countAll.rows[0]!.count, 4);
const countV = await db.query("SELECT COUNT(v) FROM t_null");
assert.equal(countV.rows[0]!.count, 2);
const sumV = await db.query("SELECT SUM(v) FROM t_null");
assert.equal(sumV.rows[0]!.sum, 30);
const avgV = await db.query("SELECT AVG(v) FROM t_null");
assert.equal(avgV.rows[0]!.avg, 15);
const minV = await db.query("SELECT MIN(v) FROM t_null");
assert.equal(minV.rows[0]!.min, 10);
const maxV = await db.query("SELECT MAX(v) FROM t_null");
assert.equal(maxV.rows[0]!.max, 20);

const asc = await db.query("SELECT id, v FROM t_null ORDER BY v ASC, id ASC");
assert.deepEqual(
  asc.rows.map((r) => r.id),
  [2, 4, 1, 3],
);
const desc = await db.query("SELECT id, v FROM t_null ORDER BY v DESC, id ASC");
assert.deepEqual(
  desc.rows.map((r) => r.id),
  [4, 2, 1, 3],
);

await db.execute("CREATE TABLE t_null_all (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_null_all (id, v) VALUES (1, NULL)");
await db.execute("INSERT INTO t_null_all (id, v) VALUES (2, NULL)");

const countAll2 = await db.query("SELECT COUNT(*) FROM t_null_all");
assert.equal(countAll2.rows[0]!.count, 2);
const countV2 = await db.query("SELECT COUNT(v) FROM t_null_all");
assert.equal(countV2.rows[0]!.count, 0);
const sumV2 = await db.query("SELECT SUM(v) FROM t_null_all");
assert.equal(sumV2.rows[0]!.sum, null);
const avgV2 = await db.query("SELECT AVG(v) FROM t_null_all");
assert.equal(avgV2.rows[0]!.avg, null);
const minV2 = await db.query("SELECT MIN(v) FROM t_null_all");
assert.equal(minV2.rows[0]!.min, null);
const maxV2 = await db.query("SELECT MAX(v) FROM t_null_all");
assert.equal(maxV2.rows[0]!.max, null);

console.log("ok: A-TYPE-015 NULL semantics for predicates, aggregates, order");
