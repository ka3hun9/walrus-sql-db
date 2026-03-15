import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_bool (id INT PRIMARY KEY, b BOOLEAN)");

await db.execute("INSERT INTO t_bool (id, b) VALUES (1, true)");
await db.execute("INSERT INTO t_bool (id, b) VALUES (2, false)");
await db.execute("INSERT INTO t_bool (id, b) VALUES (3, 1)");
await db.execute("INSERT INTO t_bool (id, b) VALUES (4, '0')");
await db.execute("INSERT INTO t_bool (id, b) VALUES (5, 'TRUE')");
await db.execute("INSERT INTO t_bool (id, b) VALUES (6, ' false ')");

const q = await db.query("SELECT id, b FROM t_bool ORDER BY id");
assert.equal(q.rows.length, 6);
assert.equal(q.rows[0]!.b, true);
assert.equal(q.rows[1]!.b, false);
assert.equal(q.rows[2]!.b, true);
assert.equal(q.rows[3]!.b, false);
assert.equal(q.rows[4]!.b, true);
assert.equal(q.rows[5]!.b, false);

await db.execute("UPDATE t_bool SET b = ' 1 ' WHERE id = 2");
const q2 = await db.query("SELECT b FROM t_bool WHERE id = 2");
assert.equal(q2.rows[0]!.b, true);

await assert.rejects(
  db.execute("INSERT INTO t_bool (id, b) VALUES (7, 'yes')"),
  /ERR_TYPE_CONSTRAINT: invalid BOOLEAN: yes/,
);
await assert.rejects(
  db.execute("INSERT INTO t_bool (id, b) VALUES (8, 2)"),
  /ERR_TYPE_CONSTRAINT: invalid BOOLEAN: 2/,
);

console.log("ok: A-TYPE-013 BOOLEAN literal and conversion boundaries");
