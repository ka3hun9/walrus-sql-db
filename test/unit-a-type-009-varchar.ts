import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_varchar (id INT PRIMARY KEY, v VARCHAR(5))");

await db.execute("INSERT INTO t_varchar (id, v) VALUES (1, '')");
await db.execute("INSERT INTO t_varchar (id, v) VALUES (2, 'abc')");
await db.execute("INSERT INTO t_varchar (id, v) VALUES (3, '12345')");

const q = await db.query("SELECT id, v FROM t_varchar ORDER BY id");
assert.equal(q.rows.length, 3);
assert.equal(q.rows[0]!.v, "");
assert.equal(q.rows[1]!.v, "abc");
assert.equal(q.rows[2]!.v, "12345");

await db.execute("UPDATE t_varchar SET v = 'xy' WHERE id = 3");
const q2 = await db.query("SELECT v FROM t_varchar WHERE id = 3");
assert.equal(q2.rows[0]!.v, "xy");

await assert.rejects(
  db.execute("INSERT INTO t_varchar (id, v) VALUES (4, '123456')"),
  /ERR_TYPE_CONSTRAINT: VARCHAR\(5\) length overflow: 6/,
);
await assert.rejects(
  db.execute("UPDATE t_varchar SET v = 'abcdef' WHERE id = 2"),
  /ERR_TYPE_CONSTRAINT: VARCHAR\(5\) length overflow: 6/,
);

console.log("ok: A-TYPE-009 VARCHAR length boundaries");
