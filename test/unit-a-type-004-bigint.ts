import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_bigint (id INT PRIMARY KEY, v BIGINT)");

await db.execute("INSERT INTO t_bigint (id, v) VALUES (1, -9223372036854775808)");
await db.execute("INSERT INTO t_bigint (id, v) VALUES (2, 9223372036854775807)");
await db.execute("INSERT INTO t_bigint (id, v) VALUES (3, 9007199254740991)");
await db.execute("INSERT INTO t_bigint (id, v) VALUES (4, '9007199254740993')");

const q = await db.query("SELECT id, v FROM t_bigint ORDER BY id");
assert.equal(q.rows.length, 4);
assert.equal(q.rows[0]!.v, "-9223372036854775808");
assert.equal(q.rows[1]!.v, "9223372036854775807");
assert.equal(q.rows[2]!.v, 9007199254740991);
assert.equal(q.rows[3]!.v, "9007199254740993");

await db.execute("UPDATE t_bigint SET v = '9223372036854775806' WHERE id = 3");
const q2 = await db.query("SELECT v FROM t_bigint WHERE id = 3");
assert.equal(q2.rows[0]!.v, "9223372036854775806");

await assert.rejects(
  db.execute("INSERT INTO t_bigint (id, v) VALUES (5, 9223372036854775808)"),
  /ERR_TYPE_CONSTRAINT: BIGINT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_bigint (id, v) VALUES (6, -9223372036854775809)"),
  /ERR_TYPE_CONSTRAINT: BIGINT out of range/,
);
await assert.rejects(
  db.execute("INSERT INTO t_bigint (id, v) VALUES (7, '3.14')"),
  /ERR_TYPE_CONSTRAINT: expected integer for BIGINT/,
);

console.log("ok: A-TYPE-004 BIGINT precision and boundaries");
