import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE nn_base (id INT PRIMARY KEY, name TEXT NOT NULL)");
await assert.rejects(
  db.execute("INSERT INTO nn_base (id, name) VALUES (1, NULL)"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);
await assert.rejects(
  db.execute("INSERT INTO nn_base (id) VALUES (1)"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);

await db.execute("INSERT INTO nn_base (id, name) VALUES (1, 'Alice')");
await assert.rejects(
  db.execute("UPDATE nn_base SET name = NULL WHERE id = 1"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);

await db.execute("CREATE TABLE nn_empty (id INT PRIMARY KEY)");
await db.execute("ALTER TABLE nn_empty ADD COLUMN age INT NOT NULL");
await assert.rejects(
  db.execute("INSERT INTO nn_empty (id) VALUES (1)"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);
await db.execute("INSERT INTO nn_empty (id, age) VALUES (1, 18)");

await db.execute("CREATE TABLE nn_nonempty (id INT PRIMARY KEY)");
await db.execute("INSERT INTO nn_nonempty (id) VALUES (1)");
await db.execute("ALTER TABLE nn_nonempty ADD COLUMN flag INT NOT NULL DEFAULT 1");
await db.execute("INSERT INTO nn_nonempty (id) VALUES (2)");

const q = await db.query("SELECT id, flag FROM nn_nonempty ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.flag]),
  [
    [1, 1],
    [2, 1],
  ],
);

console.log("ok: F-CONST-003 NOT NULL enforcement across DDL/DML paths");
