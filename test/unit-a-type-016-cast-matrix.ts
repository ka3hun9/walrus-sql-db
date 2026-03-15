import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlRuntimeType, resolveCastPolicy } from "../src/types.js";

assert.equal(resolveCastPolicy(SqlRuntimeType.TEXT, SqlRuntimeType.INT, "implicit"), "allow");
assert.equal(resolveCastPolicy(SqlRuntimeType.BOOLEAN, SqlRuntimeType.INT, "implicit"), "reject");
assert.equal(resolveCastPolicy(SqlRuntimeType.BOOLEAN, SqlRuntimeType.INT, "explicit"), "allow");
assert.equal(resolveCastPolicy(SqlRuntimeType.INT, SqlRuntimeType.TIMESTAMP, "explicit"), "reject");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_cast (id INT PRIMARY KEY, i INT, b BOOLEAN, t TEXT)");

await db.execute("INSERT INTO t_cast (id, i, b, t) VALUES (1, '42', '1', 123)");
const inserted = await db.query("SELECT i, b, t FROM t_cast WHERE id = 1");
assert.equal(inserted.rows[0]!.i, 42);
assert.equal(inserted.rows[0]!.b, true);
assert.equal(inserted.rows[0]!.t, "123");

await assert.rejects(
  db.execute("INSERT INTO t_cast (id, i, b, t) VALUES (2, true, false, 'x')"),
  /ERR_TYPE_CONSTRAINT: implicit cast BOOLEAN -> INT not allowed/,
);

const castInt = await db.query("SELECT CAST('123' AS INT) AS c FROM t_cast WHERE id = 1");
assert.equal(castInt.rows[0]!.c, 123);

const castBool = await db.query("SELECT CAST(' true ' AS BOOLEAN) AS c FROM t_cast WHERE id = 1");
assert.equal(castBool.rows[0]!.c, true);

const castDouble = await db.query("SELECT CAST('1.5' AS DOUBLE) AS c FROM t_cast WHERE id = 1");
assert.equal(castDouble.rows[0]!.c, 1.5);

await assert.rejects(
  db.query("SELECT CAST('abc' AS INT) AS c FROM t_cast WHERE id = 1"),
  /ERR_TYPE_CONSTRAINT: invalid CAST to INT: abc/,
);
await assert.rejects(
  db.query("SELECT CAST('2' AS BOOLEAN) AS c FROM t_cast WHERE id = 1"),
  /ERR_TYPE_CONSTRAINT: invalid CAST to BOOLEAN: 2/,
);

console.log("ok: A-TYPE-016 CAST/implicit conversion matrix and conflict strategy");
