import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_set1_left (id INT, label TEXT)");
await db.execute("CREATE TABLE p3_set1_right (id INT, label TEXT)");
await db.execute("CREATE TABLE p3_set1_single (id INT)");

await db.execute("INSERT INTO p3_set1_left (id, label) VALUES (1, 'a')");
await db.execute("INSERT INTO p3_set1_left (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set1_left (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set1_right (id, label) VALUES (2, 'b')");
await db.execute("INSERT INTO p3_set1_right (id, label) VALUES (3, 'c')");
await db.execute("INSERT INTO p3_set1_single (id) VALUES (9)");

const unionAll = await db.query(
  "SELECT id FROM p3_set1_left UNION ALL SELECT id FROM p3_set1_right ORDER BY id",
);
assert.deepEqual(unionAll.rows.map((r) => r.id), [1, 2, 2, 2, 3]);

const unionDistinct = await db.query(
  "SELECT id FROM p3_set1_left UNION SELECT id FROM p3_set1_right ORDER BY id",
);
assert.deepEqual(unionDistinct.rows.map((r) => r.id), [1, 2, 3]);

const chainedMixed = await db.query(
  "SELECT id FROM p3_set1_left WHERE id = 2 UNION ALL SELECT id FROM p3_set1_right WHERE id = 2 UNION SELECT id FROM p3_set1_right WHERE id = 3 ORDER BY id",
);
assert.deepEqual(chainedMixed.rows.map((r) => r.id), [2, 3]);

const chainedTailOrderLimit = await db.query(
  "SELECT id FROM p3_set1_left WHERE id = 1 UNION SELECT id FROM p3_set1_right WHERE id = 3 UNION ALL SELECT id FROM p3_set1_right WHERE id = 2 ORDER BY id DESC LIMIT 2",
);
assert.deepEqual(chainedTailOrderLimit.rows.map((r) => r.id), [3, 2]);

const emptyLeftAlias = await db.query(
  "SELECT id AS key_id FROM p3_set1_left WHERE 1 = 0 UNION ALL SELECT id FROM p3_set1_right WHERE id = 3",
);
assert.deepEqual(emptyLeftAlias.rows, [{ key_id: 3 }]);

let explicitArityError: unknown = null;
try {
  await db.query("SELECT id, label FROM p3_set1_left UNION SELECT id FROM p3_set1_single");
} catch (err) {
  explicitArityError = err;
}
assert.ok(explicitArityError instanceof SqlEngineError);
assert.equal((explicitArityError as SqlEngineError).code, "SQL_SEMANTIC_TYPE_MISMATCH");

let runtimeArityError: unknown = null;
try {
  await db.query("SELECT * FROM p3_set1_left UNION SELECT id FROM p3_set1_single");
} catch (err) {
  runtimeArityError = err;
}
assert.ok(runtimeArityError instanceof SqlEngineError);
assert.equal((runtimeArityError as SqlEngineError).code, "SQL_SEMANTIC_TYPE_MISMATCH");

console.log("ok: P3-SET-001 UNION / UNION ALL semantics");
