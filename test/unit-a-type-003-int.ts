import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_int (id INT PRIMARY KEY, v INT)");

await db.execute("INSERT INTO t_int (id, v) VALUES (1, -2147483648)");
await db.execute("INSERT INTO t_int (id, v) VALUES (2, 2147483647)");
await db.execute("INSERT INTO t_int (id, v) VALUES (3, '2048')");

const q = await db.query("SELECT id, v FROM t_int ORDER BY id");
assert.equal(q.rows.length, 3);
assert.equal(q.rows[0]!.v, -2147483648);
assert.equal(q.rows[1]!.v, 2147483647);
assert.equal(q.rows[2]!.v, 2048);

await db.execute("UPDATE t_int SET v = '-42' WHERE id = 3");
const q2 = await db.query("SELECT v FROM t_int WHERE id = 3");
assert.equal(q2.rows[0]!.v, -42);

await assert.rejects(
  db.execute("INSERT INTO t_int (id, v) VALUES (4, 2147483648)"),
  /ERR_TYPE_CONSTRAINT: INT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_int (id, v) VALUES (5, -2147483649)"),
  /ERR_TYPE_CONSTRAINT: INT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_int (id, v) VALUES (6, '7.5')"),
  /ERR_TYPE_CONSTRAINT: expected integer for INT/,
);

console.log("ok: A-TYPE-003 INT coercion and boundaries");
