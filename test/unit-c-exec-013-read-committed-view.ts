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

await writer.execute("CREATE TABLE iso_rc (id INT PRIMARY KEY, v INT)");
await writer.execute("INSERT INTO iso_rc (id, v) VALUES (1, 10)");

await writer.execute("BEGIN");
await writer.execute("UPDATE iso_rc SET v = 99 WHERE id = 1");

const writerInTxn = await writer.query("SELECT id, v FROM iso_rc");
assert.deepEqual(writerInTxn.rows, [{ id: 1, v: 99 }]);

const readerBeforeCommit = await reader.query("SELECT id, v FROM iso_rc");
assert.deepEqual(readerBeforeCommit.rows, [{ id: 1, v: 10 }]);

await writer.execute("COMMIT");

const readerAfterCommit = await reader.query("SELECT id, v FROM iso_rc");
assert.deepEqual(readerAfterCommit.rows, [{ id: 1, v: 99 }]);

assert.equal(writer.getIsolationLevel(), "read_committed");
assert.equal(reader.getIsolationLevel(), "read_committed");

console.log("ok: C-EXEC-013 read committed view blocks dirty reads");
