import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_set2_left (id INT, label TEXT)");
await db.execute("CREATE TABLE p3_set2_right (id INT, label TEXT)");
await db.execute("CREATE TABLE p3_set2_single (id INT)");

await db.execute("INSERT INTO p3_set2_left (id, label) VALUES (1, 'a')");
await db.execute("INSERT INTO p3_set2_left (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set2_left (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set2_left (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set2_left (id, label) VALUES (3, 'c')");
await db.execute("INSERT INTO p3_set2_right (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set2_right (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set2_right (id, label) VALUES (4, 'd')");
await db.execute("INSERT INTO p3_set2_single (id) VALUES (9)");

const intersectDistinct = await db.query(
  "SELECT id FROM p3_set2_left INTERSECT SELECT id FROM p3_set2_right ORDER BY id",
);
assert.deepEqual(intersectDistinct.rows.map((r) => r.id), [2]);

const intersectAll = await db.query(
  "SELECT id FROM p3_set2_left INTERSECT ALL SELECT id FROM p3_set2_right ORDER BY id",
);
assert.deepEqual(intersectAll.rows.map((r) => r.id), [2, 2]);

const chainedMixed = await db.query(
  "SELECT id FROM p3_set2_left WHERE id >= 2 INTERSECT ALL SELECT id FROM p3_set2_right WHERE id <= 2 INTERSECT SELECT id FROM p3_set2_right WHERE id = 2 ORDER BY id",
);
assert.deepEqual(chainedMixed.rows.map((r) => r.id), [2]);

const chainedTailOrderLimit = await db.query(
  "SELECT id FROM p3_set2_left INTERSECT ALL SELECT id FROM p3_set2_right ORDER BY id DESC LIMIT 1",
);
assert.deepEqual(chainedTailOrderLimit.rows.map((r) => r.id), [2]);

const aliasProjection = await db.query(
  "SELECT id AS key_id FROM p3_set2_left WHERE id = 2 INTERSECT SELECT id FROM p3_set2_right WHERE id = 2",
);
assert.deepEqual(aliasProjection.rows, [{ key_id: 2 }]);

let explicitArityError: unknown = null;
try {
  await db.query("SELECT id, label FROM p3_set2_left INTERSECT SELECT id FROM p3_set2_single");
} catch (err) {
  explicitArityError = err;
}
assert.ok(explicitArityError instanceof SqlEngineError);
assert.equal((explicitArityError as SqlEngineError).code, "SQL_SEMANTIC_TYPE_MISMATCH");

let runtimeArityError: unknown = null;
try {
  await db.query("SELECT * FROM p3_set2_left INTERSECT SELECT id FROM p3_set2_single");
} catch (err) {
  runtimeArityError = err;
}
assert.ok(runtimeArityError instanceof SqlEngineError);
assert.equal((runtimeArityError as SqlEngineError).code, "SQL_SEMANTIC_TYPE_MISMATCH");

console.log("ok: P3-SET-002 INTERSECT / INTERSECT ALL semantics");
