import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlRuntimeType, convertTypedValue, fromLiteral } from "../src/types.js";

const explicitInt = convertTypedValue(fromLiteral("42"), SqlRuntimeType.INT, {
  mode: "explicit",
  sourceContext: "k7.explicit",
});
assert.equal(explicitInt.type, SqlRuntimeType.INT);
assert.equal(explicitInt.value, 42);
assert.equal(explicitInt.metadata.sourceContext, "k7.explicit");

const explicitBool = convertTypedValue(fromLiteral("true"), SqlRuntimeType.BOOLEAN, {
  mode: "explicit",
  sourceContext: "k7.bool",
});
assert.equal(explicitBool.value, true);

assert.throws(
  () => convertTypedValue(fromLiteral("abc"), SqlRuntimeType.INT, { mode: "explicit" }),
  /(invalid INT literal|expected integer for INT)/,
);

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const implicitCoerced = (db as unknown as {
  coerceByType: (type: { name: "INT" }, value: unknown, sourceContext: string) => unknown;
}).coerceByType({ name: "INT" }, fromLiteral("99"), "k7.implicit");
assert.equal(implicitCoerced, 99);

await db.execute("CREATE TABLE t_k7 (id INT PRIMARY KEY, v TEXT)");
await db.execute("INSERT INTO t_k7 (id, v) VALUES (1, '15')");
await db.execute("INSERT INTO t_k7 (id, v) VALUES (2, 'true')");

const castInt = await db.query("SELECT CAST(v AS INT) AS vi FROM t_k7 WHERE id = 1");
assert.equal(castInt.rows[0]!.vi, 15);

const castBool = await db.query("SELECT CAST(v AS BOOLEAN) AS vb FROM t_k7 WHERE id = 2");
assert.equal(castBool.rows[0]!.vb, true);

console.log("ok: K-TVAL-007 cast + implicit conversion typed converter");
