import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const expectDeleteBlocked = async (action: Promise<unknown>): Promise<void> => {
  await assert.rejects(
    action,
    (err: unknown) =>
      err instanceof Error
      && /^ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY:/.test(err.message)
      && /ON DELETE (RESTRICT|NO ACTION)/.test(err.message),
  );
};

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
});

await db.execute("CREATE TABLE parent_fk005 (id INT PRIMARY KEY)");
await db.execute(
  "CREATE TABLE child_fk005_r (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk005(id) ON DELETE RESTRICT)",
);
await db.execute(
  "CREATE TABLE child_fk005_n (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk005(id) ON DELETE NO ACTION)",
);

await db.execute("INSERT INTO parent_fk005 (id) VALUES (1)");
await db.execute("INSERT INTO parent_fk005 (id) VALUES (2)");
await db.execute("INSERT INTO child_fk005_r (id, parent_id) VALUES (10, 1)");
await db.execute("INSERT INTO child_fk005_n (id, parent_id) VALUES (20, 2)");

await expectDeleteBlocked(db.execute("DELETE FROM parent_fk005 WHERE id = 1"));
await expectDeleteBlocked(db.execute("DELETE FROM parent_fk005 WHERE id = 2"));

await db.execute("DELETE FROM child_fk005_r WHERE id = 10");
await db.execute("DELETE FROM child_fk005_n WHERE id = 20");

const d1 = await db.execute("DELETE FROM parent_fk005 WHERE id = 1");
const d2 = await db.execute("DELETE FROM parent_fk005 WHERE id = 2");
assert.equal(d1.affectedRows, 1);
assert.equal(d2.affectedRows, 1);

const parentLeft = await db.query("SELECT * FROM parent_fk005");
assert.deepEqual(parentLeft.rows, []);

console.log("ok: F-FK-005 ON DELETE RESTRICT/NO ACTION enforcement");
