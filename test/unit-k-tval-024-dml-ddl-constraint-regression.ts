import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute(
  "CREATE TABLE t_k24 (id INT PRIMARY KEY, code TEXT UNIQUE, score INT NOT NULL DEFAULT '0', active BOOLEAN NOT NULL DEFAULT 'true')",
);

await db.execute("INSERT INTO t_k24 (id, code, score, active) VALUES ('1', 'A', '10', 'false')");
await db.execute("INSERT INTO t_k24 (id, code) VALUES (2, 'B')");

let rows = await db.query("SELECT id, code, score, active FROM t_k24 ORDER BY id");
assert.deepEqual(rows.rows, [
  { id: 1, code: "A", score: 10, active: false },
  { id: 2, code: "B", score: 0, active: true },
]);

await db.execute("UPDATE t_k24 SET score = '15' WHERE id = '1'");
await db.execute("UPDATE t_k24 SET active = 'true' WHERE id = '1'");

rows = await db.query("SELECT id, score, active FROM t_k24 WHERE id = 1");
assert.deepEqual(rows.rows, [{ id: 1, score: 15, active: true }]);

await assert.rejects(
  db.execute("UPDATE t_k24 SET code = 'A' WHERE id = 2"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY:/,
);

await assert.rejects(
  db.execute("UPDATE t_k24 SET score = NULL WHERE id = 1"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL:/,
);

await db.execute("ALTER TABLE t_k24 ADD COLUMN level INT DEFAULT '3'");

rows = await db.query("SELECT id, level FROM t_k24 ORDER BY id");
assert.deepEqual(rows.rows, [
  { id: 1, level: 3 },
  { id: 2, level: 3 },
]);

await db.execute("INSERT INTO t_k24 (id, code, score, active) VALUES (3, 'C', '7', 'false')");
rows = await db.query("SELECT id, code, level FROM t_k24 ORDER BY id");
assert.deepEqual(rows.rows, [
  { id: 1, code: "A", level: 3 },
  { id: 2, code: "B", level: 3 },
  { id: 3, code: "C", level: 3 },
]);

console.log("ok: K-TVAL-024 typed DML/DDL/constraint regression");
