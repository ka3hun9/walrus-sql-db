import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const expectUpdateBlocked = async (action: Promise<unknown>): Promise<void> => {
  await assert.rejects(
    action,
    (err: unknown) =>
      err instanceof Error
      && /^ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY:/.test(err.message)
      && /ON UPDATE (RESTRICT|NO ACTION)/.test(err.message),
  );
};

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
});

await db.execute("CREATE TABLE parent_fk006 (id INT PRIMARY KEY, v INT)");
await db.execute(
  "CREATE TABLE child_fk006_c (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk006(id) ON UPDATE CASCADE)",
);
await db.execute(
  "CREATE TABLE child_fk006_r (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk006(id) ON UPDATE RESTRICT)",
);
await db.execute(
  "CREATE TABLE child_fk006_n (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk006(id) ON UPDATE NO ACTION)",
);

await db.execute("INSERT INTO parent_fk006 (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO child_fk006_c (id, parent_id) VALUES (100, 1)");
await db.execute("INSERT INTO child_fk006_r (id, parent_id) VALUES (200, 1)");
await db.execute("INSERT INTO child_fk006_n (id, parent_id) VALUES (300, 1)");

await expectUpdateBlocked(db.execute("UPDATE parent_fk006 SET id = 2 WHERE id = 1"));

await db.execute("DELETE FROM child_fk006_r WHERE id = 200");
await expectUpdateBlocked(db.execute("UPDATE parent_fk006 SET id = 2 WHERE id = 1"));

await db.execute("DELETE FROM child_fk006_n WHERE id = 300");
const updateDirect = await db.execute("UPDATE parent_fk006 SET id = 2 WHERE id = 1");
assert.equal(updateDirect.affectedRows, 2);

const childAfterDirect = await db.query("SELECT id, parent_id FROM child_fk006_c ORDER BY id ASC");
assert.deepEqual(childAfterDirect.rows, [{ id: 100, parent_id: 2 }]);

await db.execute("BEGIN");
const updateTx = await db.execute("UPDATE parent_fk006 SET id = 3 WHERE id = 2");
assert.equal(updateTx.affectedRows, 2);
await db.execute("COMMIT");

const parentAfter = await db.query("SELECT id FROM parent_fk006");
assert.deepEqual(parentAfter.rows, [{ id: 3 }]);
const childAfterTx = await db.query("SELECT id, parent_id FROM child_fk006_c");
assert.deepEqual(childAfterTx.rows, [{ id: 100, parent_id: 3 }]);

console.log("ok: F-FK-006 ON UPDATE CASCADE/RESTRICT policy");
