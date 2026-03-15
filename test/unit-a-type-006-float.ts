import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_float (id INT PRIMARY KEY, v FLOAT)");
await db.execute("INSERT INTO t_float (id, v) VALUES (1, '3.14')");
await db.execute("INSERT INTO t_float (id, v) VALUES (2, 1e2)");

const sum = 0.1 + 0.2;
await db.execute(`INSERT INTO t_float (id, v) VALUES (3, ${sum})`);

const ordered = await db.query("SELECT id, v FROM t_float ORDER BY v ASC");
assert.equal(ordered.rows.length, 3);
assert.equal(ordered.rows[0]!.id, 3);
assert.equal(ordered.rows[1]!.id, 1);
assert.equal(ordered.rows[2]!.id, 2);
assert.equal(ordered.rows[1]!.v, 3.14);
assert.equal(ordered.rows[2]!.v, 100);

const exactEq = await db.query(`SELECT id FROM t_float WHERE v = ${sum}`);
assert.equal(exactEq.rows.length, 1);
assert.equal(exactEq.rows[0]!.id, 3);

const roundedEq = await db.query("SELECT id FROM t_float WHERE v = 0.3");
assert.equal(roundedEq.rows.length, 0);

const gt = await db.query("SELECT id FROM t_float WHERE v > 3 ORDER BY id");
assert.deepEqual(
  gt.rows.map((r) => r.id),
  [1, 2],
);

await assert.rejects(
  db.execute("INSERT INTO t_float (id, v) VALUES (4, 'Infinity')"),
  /ERR_TYPE_CONSTRAINT: expected numeric for FLOAT/,
);
await assert.rejects(
  db.execute("INSERT INTO t_float (id, v) VALUES (5, 'NaN')"),
  /ERR_TYPE_CONSTRAINT: expected numeric for FLOAT/,
);

console.log("ok: A-TYPE-006 FLOAT parsing, precision behavior, and comparisons");
