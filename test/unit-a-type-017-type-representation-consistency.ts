import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlRuntimeType, createRuntimeTypeModel, normalizeRuntimeTypeName } from "../src/types.js";

assert.equal(normalizeRuntimeTypeName("INTEGER"), SqlRuntimeType.INT);
assert.equal(normalizeRuntimeTypeName("REAL"), SqlRuntimeType.DOUBLE);
assert.equal(normalizeRuntimeTypeName("NUMERIC"), SqlRuntimeType.DECIMAL);
assert.equal(normalizeRuntimeTypeName("unknown_type"), null);

assert.equal(createRuntimeTypeModel(SqlRuntimeType.INT).name, "INT");
assert.equal(createRuntimeTypeModel(SqlRuntimeType.DOUBLE).name, "DOUBLE");
assert.equal(createRuntimeTypeModel(SqlRuntimeType.DECIMAL, { precision: 6, scale: 2 }).name, "DECIMAL");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute(
  "CREATE TABLE t_repr (id INTEGER PRIMARY KEY, score REAL, amount NUMERIC(6,2), label VARCHAR(5))",
);
await db.execute("INSERT INTO t_repr (id, score, amount, label) VALUES (1, '3.5', '12.3', 'abc')");

const inserted = await db.query("SELECT id, score, amount, label FROM t_repr WHERE id = 1");
assert.equal(inserted.rows[0]!.id, 1);
assert.equal(inserted.rows[0]!.score, 3.5);
assert.equal(inserted.rows[0]!.amount, "12.30");
assert.equal(inserted.rows[0]!.label, "abc");

await db.execute("UPDATE t_repr SET amount = '7' WHERE id = 1");
const updated = await db.query("SELECT amount FROM t_repr WHERE id = 1");
assert.equal(updated.rows[0]!.amount, "7.00");

const casted = await db.query("SELECT CAST(score AS REAL) AS s2, CAST(id AS INTEGER) AS id2 FROM t_repr WHERE id = 1");
assert.equal(casted.rows[0]!.s2, 3.5);
assert.equal(casted.rows[0]!.id2, 1);

console.log("ok: A-TYPE-017 parser/expression/storage type representation consistency");
