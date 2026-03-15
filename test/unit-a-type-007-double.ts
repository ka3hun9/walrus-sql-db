import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_double (id INT PRIMARY KEY, v DOUBLE)");
await db.execute("INSERT INTO t_double (id, v) VALUES (1, 1.7976931348623157e308)");
await db.execute("INSERT INTO t_double (id, v) VALUES (2, 5e-324)");
await db.execute("INSERT INTO t_double (id, v) VALUES (3, '6.02214076e23')");

const sum = 0.1 + 0.2;
await db.execute(`INSERT INTO t_double (id, v) VALUES (4, ${sum})`);

const rows = await db.query("SELECT id, v FROM t_double ORDER BY id");
assert.equal(rows.rows.length, 4);
assert.equal(rows.rows[0]!.v, 1.7976931348623157e308);
assert.equal(rows.rows[1]!.v, 5e-324);
assert.equal(rows.rows[2]!.v, 6.02214076e23);
assert.equal(rows.rows[3]!.v, sum);

const exactEq = await db.query(`SELECT id FROM t_double WHERE v = ${sum}`);
assert.equal(exactEq.rows.length, 1);
assert.equal(exactEq.rows[0]!.id, 4);

const roundedEq = await db.query("SELECT id FROM t_double WHERE v = 0.3");
assert.equal(roundedEq.rows.length, 0);

const gt = await db.query("SELECT id FROM t_double WHERE v > 100000 ORDER BY id");
assert.deepEqual(
  gt.rows.map((r) => r.id),
  [1, 3],
);

await assert.rejects(
  db.execute("INSERT INTO t_double (id, v) VALUES (5, 'Infinity')"),
  /ERR_TYPE_CONSTRAINT: expected numeric for DOUBLE/,
);
await assert.rejects(
  db.execute("INSERT INTO t_double (id, v) VALUES (6, 'NaN')"),
  /ERR_TYPE_CONSTRAINT: expected numeric for DOUBLE/,
);

console.log("ok: A-TYPE-007 DOUBLE parsing, precision behavior, and comparisons");
