import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
});

await db.execute("CREATE TABLE parent_fk004 (id INT PRIMARY KEY)");
await db.execute(
  "CREATE TABLE child_fk004 (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk004(id) ON DELETE CASCADE)",
);
await db.execute(
  "CREATE TABLE grand_fk004 (id INT PRIMARY KEY, child_id INT, FOREIGN KEY (child_id) REFERENCES child_fk004(id) ON DELETE CASCADE)",
);

await db.execute("INSERT INTO parent_fk004 (id) VALUES (1)");
await db.execute("INSERT INTO parent_fk004 (id) VALUES (2)");
await db.execute("INSERT INTO child_fk004 (id, parent_id) VALUES (10, 1)");
await db.execute("INSERT INTO child_fk004 (id, parent_id) VALUES (11, 2)");
await db.execute("INSERT INTO grand_fk004 (id, child_id) VALUES (100, 10)");
await db.execute("INSERT INTO grand_fk004 (id, child_id) VALUES (101, 11)");

const deleteOne = await db.execute("DELETE FROM parent_fk004 WHERE id = 1");
assert.equal(deleteOne.affectedRows, 3);

const childAfterFirstDelete = await db.query("SELECT id, parent_id FROM child_fk004 ORDER BY id ASC");
assert.deepEqual(childAfterFirstDelete.rows, [{ id: 11, parent_id: 2 }]);

const grandAfterFirstDelete = await db.query("SELECT id, child_id FROM grand_fk004 ORDER BY id ASC");
assert.deepEqual(grandAfterFirstDelete.rows, [{ id: 101, child_id: 11 }]);

await db.execute("BEGIN");
const deleteTwo = await db.execute("DELETE FROM parent_fk004 WHERE id = 2");
assert.equal(deleteTwo.affectedRows, 3);
await db.execute("COMMIT");

const parentAfter = await db.query("SELECT * FROM parent_fk004");
const childAfter = await db.query("SELECT * FROM child_fk004");
const grandAfter = await db.query("SELECT * FROM grand_fk004");
assert.deepEqual(parentAfter.rows, []);
assert.deepEqual(childAfter.rows, []);
assert.deepEqual(grandAfter.rows, []);

console.log("ok: F-FK-004 ON DELETE CASCADE (recursive + tx path)");
