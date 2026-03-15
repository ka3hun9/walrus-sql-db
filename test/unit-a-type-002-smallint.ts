import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_smallint (id INT PRIMARY KEY, v SMALLINT)");

await db.execute("INSERT INTO t_smallint (id, v) VALUES (1, -32768)");
await db.execute("INSERT INTO t_smallint (id, v) VALUES (2, 32767)");
await db.execute("INSERT INTO t_smallint (id, v) VALUES (3, '123')");

const q = await db.query("SELECT id, v FROM t_smallint ORDER BY id");
assert.equal(q.rows.length, 3);
assert.equal(q.rows[0]!.v, -32768);
assert.equal(q.rows[1]!.v, 32767);
assert.equal(q.rows[2]!.v, 123);

await db.execute("UPDATE t_smallint SET v = '-42' WHERE id = 3");
const q2 = await db.query("SELECT v FROM t_smallint WHERE id = 3");
assert.equal(q2.rows[0]!.v, -42);

await assert.rejects(
  db.execute("INSERT INTO t_smallint (id, v) VALUES (4, 32768)"),
  /ERR_TYPE_CONSTRAINT: SMALLINT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_smallint (id, v) VALUES (5, -32769)"),
  /ERR_TYPE_CONSTRAINT: SMALLINT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_smallint (id, v) VALUES (6, '3.14')"),
  /ERR_TYPE_CONSTRAINT: expected integer for SMALLINT/,
);

console.log("ok: A-TYPE-002 SMALLINT coercion and boundaries");
