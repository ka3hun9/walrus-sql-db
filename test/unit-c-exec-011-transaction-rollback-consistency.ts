import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

type RowSnapshot = { id: number; v: number };
type UniqueIndexRowsSnapshot = Record<string, number[]>;

type TransactionTableWriteSet = {
  rows: Array<Record<string, unknown>>;
  uniqueIndexes: Map<string, Map<string, Record<string, unknown>>>;
};

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const internals = db as unknown as {
  tables: Map<string, Array<Record<string, unknown>>>;
  uniqueIndexes: Map<string, Map<string, Map<string, Record<string, unknown>>>>;
  transactionWriteSet: { tables: Map<string, TransactionTableWriteSet> } | null;
};

const readCommittedRows = (table: string): RowSnapshot[] => {
  const rows = internals.tables.get(table) ?? [];
  return rows
    .map((row) => ({ id: Number(row.id), v: Number(row.v) }))
    .sort((a, b) => a.id - b.id);
};

const readCommittedUniqueIndexRows = (table: string): UniqueIndexRowsSnapshot => {
  const tableIndexes = internals.uniqueIndexes.get(table);
  if (!tableIndexes) return {};

  const out: UniqueIndexRowsSnapshot = {};
  for (const [groupName, groupIndex] of tableIndexes.entries()) {
    out[groupName] = [...groupIndex.values()]
      .map((row) => Number(row.id))
      .sort((a, b) => a - b);
  }
  return out;
};

const readStagedRows = (table: string): RowSnapshot[] => {
  const staged = internals.transactionWriteSet?.tables.get(table);
  if (!staged) return [];
  return staged.rows
    .map((row) => ({ id: Number(row.id), v: Number(row.v) }))
    .sort((a, b) => a.id - b.id);
};

const readStagedUniqueIndexRows = (table: string): UniqueIndexRowsSnapshot => {
  const staged = internals.transactionWriteSet?.tables.get(table);
  if (!staged) return {};

  const out: UniqueIndexRowsSnapshot = {};
  for (const [groupName, groupIndex] of staged.uniqueIndexes.entries()) {
    out[groupName] = [...groupIndex.values()]
      .map((row) => Number(row.id))
      .sort((a, b) => a - b);
  }
  return out;
};

await db.execute("CREATE TABLE txn_rb_consistency (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO txn_rb_consistency (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO txn_rb_consistency (id, v) VALUES (2, 20)");

const committedBaselineRows = readCommittedRows("txn_rb_consistency");
const committedBaselineIndexes = readCommittedUniqueIndexRows("txn_rb_consistency");
assert.deepEqual(committedBaselineRows, [
  { id: 1, v: 10 },
  { id: 2, v: 20 },
]);
assert.deepEqual(committedBaselineIndexes, { ID: [1, 2] });

await db.execute("BEGIN");
await db.execute("UPDATE txn_rb_consistency SET v = 11 WHERE id = 1");
await db.execute("INSERT INTO txn_rb_consistency (id, v) VALUES (3, 30)");
assert.deepEqual(readStagedRows("txn_rb_consistency"), [
  { id: 1, v: 11 },
  { id: 2, v: 20 },
  { id: 3, v: 30 },
]);
assert.deepEqual(readStagedUniqueIndexRows("txn_rb_consistency"), { ID: [1, 2, 3] });

await db.execute("ROLLBACK");
assert.equal(db.getTransactionState(), "idle");
assert.equal(internals.transactionWriteSet, null);
assert.deepEqual(readCommittedRows("txn_rb_consistency"), committedBaselineRows);
assert.deepEqual(readCommittedUniqueIndexRows("txn_rb_consistency"), committedBaselineIndexes);
const explicitRollbackVisibleRows = await db.query("SELECT id, v FROM txn_rb_consistency ORDER BY id");
assert.deepEqual(explicitRollbackVisibleRows.rows, committedBaselineRows);

await db.execute("BEGIN");
await db.execute("UPDATE txn_rb_consistency SET v = 222 WHERE id = 2");
await db.execute("INSERT INTO txn_rb_consistency (id, v) VALUES (4, 40)");
assert.deepEqual(readStagedRows("txn_rb_consistency"), [
  { id: 1, v: 10 },
  { id: 2, v: 222 },
  { id: 4, v: 40 },
]);
assert.deepEqual(readStagedUniqueIndexRows("txn_rb_consistency"), { ID: [1, 2, 4] });

await assert.rejects(
  db.execute("INSERT INTO txn_rb_consistency (id, v) VALUES (4, 4000)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

assert.equal(db.getTransactionState(), "aborted");
assert.equal(internals.transactionWriteSet, null);
assert.deepEqual(readCommittedRows("txn_rb_consistency"), committedBaselineRows);
assert.deepEqual(readCommittedUniqueIndexRows("txn_rb_consistency"), committedBaselineIndexes);
await assert.rejects(db.query("SELECT id, v FROM txn_rb_consistency ORDER BY id"), /ERR_TRANSACTION_STATE/);

await db.execute("ROLLBACK");
assert.equal(db.getTransactionState(), "idle");
const implicitRollbackVisibleRows = await db.query("SELECT id, v FROM txn_rb_consistency ORDER BY id");
assert.deepEqual(implicitRollbackVisibleRows.rows, committedBaselineRows);

console.log("ok: C-EXEC-011 explicit and implicit rollback clear staged state consistently");
