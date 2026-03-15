import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_decimal (id INT PRIMARY KEY, amount DECIMAL(5,2))");

await db.execute("INSERT INTO t_decimal (id, amount) VALUES (1, '123.45')");
await db.execute("INSERT INTO t_decimal (id, amount) VALUES (2, 99)");
await db.execute("INSERT INTO t_decimal (id, amount) VALUES (3, '1.2')");
await db.execute("INSERT INTO t_decimal (id, amount) VALUES (4, -999.99)");
await db.execute("INSERT INTO t_decimal (id, amount) VALUES (5, 999.99)");

const q = await db.query("SELECT id, amount FROM t_decimal ORDER BY id");
assert.equal(q.rows.length, 5);
assert.equal(q.rows[0]!.amount, "123.45");
assert.equal(q.rows[1]!.amount, "99.00");
assert.equal(q.rows[2]!.amount, "1.20");
assert.equal(q.rows[3]!.amount, "-999.99");
assert.equal(q.rows[4]!.amount, "999.99");

await db.execute("UPDATE t_decimal SET amount = '0.1' WHERE id = 1");
const q2 = await db.query("SELECT amount FROM t_decimal WHERE id = 1");
assert.equal(q2.rows[0]!.amount, "0.10");

await assert.rejects(
  db.execute("INSERT INTO t_decimal (id, amount) VALUES (6, 1000.00)"),
  /ERR_TYPE_CONSTRAINT: DECIMAL\(5,2\) overflow/,
);
await assert.rejects(
  db.execute("INSERT INTO t_decimal (id, amount) VALUES (7, '12.345')"),
  /ERR_TYPE_CONSTRAINT: DECIMAL\(5,2\) scale overflow \(rounding disabled\)/,
);
await assert.rejects(
  db.execute("INSERT INTO t_decimal (id, amount) VALUES (8, 'abc')"),
  /ERR_TYPE_CONSTRAINT: invalid DECIMAL literal/,
);

console.log("ok: A-TYPE-005 DECIMAL precision/scale and reject policy");
