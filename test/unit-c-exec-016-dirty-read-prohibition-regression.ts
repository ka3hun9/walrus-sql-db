import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const shareCommittedStore = (source: WalrusSqlClient, target: WalrusSqlClient): void => {
  const src = source as unknown as Record<string, unknown>;
  const dst = target as unknown as Record<string, unknown>;
  dst.tables = src.tables;
  dst.schemas = src.schemas;
  dst.uniqueIndexes = src.uniqueIndexes;
  dst.uniqueGroupsCache = src.uniqueGroupsCache;
  dst.constraintCost = src.constraintCost;
  dst.rowVersions = src.rowVersions;
};

const writer = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});
const reader = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

shareCommittedStore(writer, reader);

await writer.execute("CREATE TABLE iso_dirty (id INT PRIMARY KEY, v INT)");
await writer.execute("INSERT INTO iso_dirty (id, v) VALUES (1, 10)");

await writer.execute("BEGIN");
await writer.execute("INSERT INTO iso_dirty (id, v) VALUES (2, 20)");
await writer.execute("UPDATE iso_dirty SET v = 99 WHERE id = 1");

const writerInTxn = await writer.query("SELECT id, v FROM iso_dirty ORDER BY id");
assert.deepEqual(writerInTxn.rows, [
  { id: 1, v: 99 },
  { id: 2, v: 20 },
]);

const readerBeforeCommit = await reader.query("SELECT id, v FROM iso_dirty ORDER BY id");
assert.deepEqual(readerBeforeCommit.rows, [{ id: 1, v: 10 }]);

await writer.execute("ROLLBACK");

const readerAfterRollback = await reader.query("SELECT id, v FROM iso_dirty ORDER BY id");
assert.deepEqual(readerAfterRollback.rows, [{ id: 1, v: 10 }]);

await writer.execute("BEGIN");
await writer.execute("UPDATE iso_dirty SET v = 77 WHERE id = 1");
await writer.execute("COMMIT");

const readerAfterCommit = await reader.query("SELECT id, v FROM iso_dirty ORDER BY id");
assert.deepEqual(readerAfterCommit.rows, [{ id: 1, v: 77 }]);

console.log("ok: C-EXEC-016 dirty-read prohibition regression");
