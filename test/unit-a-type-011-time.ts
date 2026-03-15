import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_time (id INT PRIMARY KEY, t TIME)");

await db.execute("INSERT INTO t_time (id, t) VALUES (1, '00:00:00')");
await db.execute("INSERT INTO t_time (id, t) VALUES (2, '23:59:59')");

const q = await db.query("SELECT id, t FROM t_time ORDER BY id");
assert.equal(q.rows.length, 2);
assert.equal(q.rows[0]!.t, "00:00:00");
assert.equal(q.rows[1]!.t, "23:59:59");

await assert.rejects(
  db.execute("INSERT INTO t_time (id, t) VALUES (3, '24:00:00')"),
  /ERR_TYPE_CONSTRAINT: invalid TIME: 24:00:00/,
);
await assert.rejects(
  db.execute("INSERT INTO t_time (id, t) VALUES (4, '12:60:00')"),
  /ERR_TYPE_CONSTRAINT: invalid TIME: 12:60:00/,
);
await assert.rejects(
  db.execute("INSERT INTO t_time (id, t) VALUES (5, '12:34:60')"),
  /ERR_TYPE_CONSTRAINT: invalid TIME: 12:34:60/,
);
await assert.rejects(
  db.execute("INSERT INTO t_time (id, t) VALUES (6, '1:2:3')"),
  /ERR_TYPE_CONSTRAINT: invalid TIME: 1:2:3/,
);

console.log("ok: A-TYPE-011 TIME format and validity checks");
