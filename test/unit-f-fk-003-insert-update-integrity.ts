import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const expectFkViolation = async (action: Promise<unknown>): Promise<void> => {
  await assert.rejects(
    action,
    (err: unknown) => err instanceof Error && /^ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY:/.test(err.message),
  );
};

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
});

await db.execute("CREATE TABLE parent_fk003 (id INT PRIMARY KEY, code INT)");
await db.execute("CREATE TABLE child_fk003 (id INT PRIMARY KEY, parent_id INT REFERENCES parent_fk003(id))");

await expectFkViolation(
  db.execute("INSERT INTO child_fk003 (id, parent_id) VALUES (1, 999)"),
);

await db.execute("INSERT INTO parent_fk003 (id, code) VALUES (1, 10)");
await db.execute("INSERT INTO child_fk003 (id, parent_id) VALUES (1, 1)");

await expectFkViolation(
  db.execute("UPDATE child_fk003 SET parent_id = 404 WHERE id = 1"),
);

await db.execute("BEGIN");
await db.execute("INSERT INTO parent_fk003 (id, code) VALUES (2, 20)");
await db.execute("INSERT INTO child_fk003 (id, parent_id) VALUES (2, 2)");
await db.execute("COMMIT");

const visible = await db.query("SELECT id, parent_id FROM child_fk003 ORDER BY id ASC");
assert.deepEqual(visible.rows, [
  { id: 1, parent_id: 1 },
  { id: 2, parent_id: 2 },
]);

console.log("ok: F-FK-003 INSERT/UPDATE FK integrity with transaction-local visibility");
