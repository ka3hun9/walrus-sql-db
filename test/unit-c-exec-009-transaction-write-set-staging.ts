import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

type CommittedRow = { id: number; v: number };

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const readCommittedRows = (): CommittedRow[] => {
  const internals = db as unknown as { tables: Map<string, Array<Record<string, unknown>>> };
  const rows = internals.tables.get("txn_stage") ?? [];
  return rows
    .map((row) => ({ id: Number(row.id), v: Number(row.v) }))
    .sort((a, b) => a.id - b.id);
};

await db.execute("CREATE TABLE txn_stage (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO txn_stage (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO txn_stage (id, v) VALUES (2, 20)");

await db.execute("BEGIN");
await db.execute("INSERT INTO txn_stage (id, v) VALUES (3, 30)");
await db.execute("UPDATE txn_stage SET v = 99 WHERE id = 1");
await db.execute("DELETE FROM txn_stage WHERE id = 2");

const inTxnBeforeCommit = await db.query("SELECT id, v FROM txn_stage ORDER BY id");
assert.deepEqual(inTxnBeforeCommit.rows, [
  { id: 1, v: 99 },
  { id: 3, v: 30 },
]);

const outsideBeforeCommit = readCommittedRows();
assert.deepEqual(outsideBeforeCommit, [
  { id: 1, v: 10 },
  { id: 2, v: 20 },
]);

await db.execute("COMMIT");
const outsideAfterCommit = readCommittedRows();
assert.deepEqual(outsideAfterCommit, [
  { id: 1, v: 99 },
  { id: 3, v: 30 },
]);

await db.execute("BEGIN");
await db.execute("INSERT INTO txn_stage (id, v) VALUES (4, 40)");
await db.execute("UPDATE txn_stage SET v = 111 WHERE id = 1");
await db.execute("DELETE FROM txn_stage WHERE id = 3");

const inTxnBeforeRollback = await db.query("SELECT id, v FROM txn_stage ORDER BY id");
assert.deepEqual(inTxnBeforeRollback.rows, [
  { id: 1, v: 111 },
  { id: 4, v: 40 },
]);

const outsideBeforeRollback = readCommittedRows();
assert.deepEqual(outsideBeforeRollback, [
  { id: 1, v: 99 },
  { id: 3, v: 30 },
]);

await db.execute("ROLLBACK");
const outsideAfterRollback = readCommittedRows();
assert.deepEqual(outsideAfterRollback, [
  { id: 1, v: 99 },
  { id: 3, v: 30 },
]);

const afterRollbackQuery = await db.query("SELECT id, v FROM txn_stage ORDER BY id");
assert.deepEqual(afterRollbackQuery.rows, [
  { id: 1, v: 99 },
  { id: 3, v: 30 },
]);

console.log("ok: C-EXEC-009 transaction-local write set staging visibility and rollback");
