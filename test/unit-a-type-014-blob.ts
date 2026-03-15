import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { decodeBlob, encodeBlob } from "../src/types.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_blob (id INT PRIMARY KEY, b BLOB)");

await db.execute("INSERT INTO t_blob (id, b) VALUES (1, 'hello')");
await db.execute("INSERT INTO t_blob (id, b) VALUES (2, 'hex:68656c6c6f')");
await db.execute("INSERT INTO t_blob (id, b) VALUES (3, 'base64:aGVsbG8=')");

const q = await db.query("SELECT id, b FROM t_blob ORDER BY id");
assert.equal(q.rows.length, 3);
for (const row of q.rows) {
  assert.equal(row.b, encodeBlob("hello"));
  assert.equal(Buffer.from(decodeBlob(String(row.b))).toString("utf8"), "hello");
}

await db.execute("UPDATE t_blob SET b = 'base64:AAEC' WHERE id = 1");
const q2 = await db.query("SELECT b FROM t_blob WHERE id = 1");
assert.equal(q2.rows[0]!.b, "base64:AAEC");
assert.deepEqual(Array.from(decodeBlob(String(q2.rows[0]!.b))), [0, 1, 2]);

await assert.rejects(
  db.execute("INSERT INTO t_blob (id, b) VALUES (4, 'base64:***')"),
  /ERR_TYPE_CONSTRAINT: invalid BLOB/,
);
await assert.rejects(
  db.execute("INSERT INTO t_blob (id, b) VALUES (5, 'hex:abc')"),
  /ERR_TYPE_CONSTRAINT: invalid BLOB/,
);

console.log("ok: A-TYPE-014 BLOB encode/decode and storage consistency");
