import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

type CommittedRow = { id: number; v: number };
type UniqueIndexRowsSnapshot = Record<string, number[]>;

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const internals = db as unknown as {
  tables: Map<string, Array<Record<string, unknown>>>;
  uniqueIndexes: Map<string, Map<string, Map<string, Record<string, unknown>>>>;
  applyCommittedTableStage: (table: string, tableStage: unknown) => void;
};

const readCommittedRows = (table: string): CommittedRow[] => {
  const rows = internals.tables.get(table) ?? [];
  return rows
    .map((row) => ({ id: Number(row.id), v: Number(row.v) }))
    .sort((a, b) => a.id - b.id);
};

const readUniqueIndexRows = (table: string): UniqueIndexRowsSnapshot => {
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

await db.execute("CREATE TABLE txn_atomic_a (id INT PRIMARY KEY, v INT)");
await db.execute("CREATE TABLE txn_atomic_b (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO txn_atomic_a (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO txn_atomic_b (id, v) VALUES (1, 100)");

await db.execute("BEGIN");
await db.execute("UPDATE txn_atomic_a SET v = 11 WHERE id = 1");
await db.execute("INSERT INTO txn_atomic_a (id, v) VALUES (2, 20)");
await db.execute("UPDATE txn_atomic_b SET v = 101 WHERE id = 1");
await db.execute("INSERT INTO txn_atomic_b (id, v) VALUES (2, 200)");
await db.execute("COMMIT");

assert.deepEqual(readCommittedRows("txn_atomic_a"), [
  { id: 1, v: 11 },
  { id: 2, v: 20 },
]);
assert.deepEqual(readCommittedRows("txn_atomic_b"), [
  { id: 1, v: 101 },
  { id: 2, v: 200 },
]);
assert.deepEqual(readUniqueIndexRows("txn_atomic_a"), { ID: [1, 2] });
assert.deepEqual(readUniqueIndexRows("txn_atomic_b"), { ID: [1, 2] });

const beforeFailureA = readCommittedRows("txn_atomic_a");
const beforeFailureB = readCommittedRows("txn_atomic_b");
const beforeFailureIndexA = readUniqueIndexRows("txn_atomic_a");
const beforeFailureIndexB = readUniqueIndexRows("txn_atomic_b");

await db.execute("BEGIN");
await db.execute("UPDATE txn_atomic_a SET v = 999 WHERE id = 1");
await db.execute("DELETE FROM txn_atomic_a WHERE id = 2");
await db.execute("UPDATE txn_atomic_b SET v = 222 WHERE id = 2");
await db.execute("INSERT INTO txn_atomic_b (id, v) VALUES (3, 300)");

const originalApplyCommittedTableStage = internals.applyCommittedTableStage;
let applyCalls = 0;
internals.applyCommittedTableStage = (table: string, tableStage: unknown): void => {
  applyCalls += 1;
  originalApplyCommittedTableStage.call(db, table, tableStage);
  if (applyCalls === 1) throw new Error("forced commit apply failure");
};

try {
  await assert.rejects(
    db.execute("COMMIT"),
    /ERR_EXECUTION_FAILED: transaction commit apply failed; restored pre-commit state: forced commit apply failure/,
  );
} finally {
  internals.applyCommittedTableStage = originalApplyCommittedTableStage;
}

assert.equal(db.getTransactionState(), "aborted");
assert.deepEqual(readCommittedRows("txn_atomic_a"), beforeFailureA);
assert.deepEqual(readCommittedRows("txn_atomic_b"), beforeFailureB);
assert.deepEqual(readUniqueIndexRows("txn_atomic_a"), beforeFailureIndexA);
assert.deepEqual(readUniqueIndexRows("txn_atomic_b"), beforeFailureIndexB);

await db.execute("ROLLBACK");
assert.equal(db.getTransactionState(), "idle");

const committedAfterRollbackA = await db.query("SELECT id, v FROM txn_atomic_a ORDER BY id");
const committedAfterRollbackB = await db.query("SELECT id, v FROM txn_atomic_b ORDER BY id");
assert.deepEqual(committedAfterRollbackA.rows, beforeFailureA);
assert.deepEqual(committedAfterRollbackB.rows, beforeFailureB);

console.log("ok: C-EXEC-010 transaction commit is atomic and rolls back on induced mid-commit failure");
