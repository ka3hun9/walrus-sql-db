import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_char (id INT PRIMARY KEY, c CHAR(4))");

await db.execute("INSERT INTO t_char (id, c) VALUES (1, 'A')");
await db.execute("INSERT INTO t_char (id, c) VALUES (2, 'ABCD')");
await db.execute("INSERT INTO t_char (id, c) VALUES (3, '')");

const q = await db.query("SELECT id, c FROM t_char ORDER BY id");
assert.equal(q.rows.length, 3);
assert.equal(q.rows[0]!.c, "A   ");
assert.equal(q.rows[1]!.c, "ABCD");
assert.equal(q.rows[2]!.c, "    ");

await db.execute("UPDATE t_char SET c = 'XY' WHERE id = 1");
const q2 = await db.query("SELECT c FROM t_char WHERE id = 1");
assert.equal(q2.rows[0]!.c, "XY  ");

await assert.rejects(
  db.execute("INSERT INTO t_char (id, c) VALUES (4, 'ABCDE')"),
  /ERR_TYPE_CONSTRAINT: CHAR\(4\) length overflow: 5/,
);
await assert.rejects(
  db.execute("UPDATE t_char SET c = '12345' WHERE id = 2"),
  /ERR_TYPE_CONSTRAINT: CHAR\(4\) length overflow: 5/,
);

console.log("ok: A-TYPE-008 CHAR padding/reject consistency");
