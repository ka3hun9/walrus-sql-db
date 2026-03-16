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

await writer.execute("CREATE TABLE exe_ctx_a (id INT PRIMARY KEY, v INT)");
await writer.execute("CREATE TABLE exe_ctx_b (id INT PRIMARY KEY, a_id INT, tag TEXT)");
await writer.execute("INSERT INTO exe_ctx_a (id, v) VALUES (1, 10)");
await writer.execute("INSERT INTO exe_ctx_b (id, a_id, tag) VALUES (1, 1, 'old')");

await writer.execute("BEGIN");
await writer.execute("UPDATE exe_ctx_a SET v = 11 WHERE id = 1");
await writer.execute("INSERT INTO exe_ctx_b (id, a_id, tag) VALUES (2, 1, 'new')");

const writerJoin = await writer.query(
  "SELECT exe_ctx_a.id, exe_ctx_a.v, exe_ctx_b.id, exe_ctx_b.tag FROM exe_ctx_a INNER JOIN exe_ctx_b ON exe_ctx_a.id = exe_ctx_b.a_id ORDER BY exe_ctx_b.id ASC",
);
assert.deepEqual(writerJoin.rows, [
  { "exe_ctx_a.id": 1, "exe_ctx_a.v": 11, "exe_ctx_b.id": 1, "exe_ctx_b.tag": "old" },
  { "exe_ctx_a.id": 1, "exe_ctx_a.v": 11, "exe_ctx_b.id": 2, "exe_ctx_b.tag": "new" },
]);

const readerBeforeCommit = await reader.query(
  "SELECT exe_ctx_a.id, exe_ctx_a.v, exe_ctx_b.id, exe_ctx_b.tag FROM exe_ctx_a INNER JOIN exe_ctx_b ON exe_ctx_a.id = exe_ctx_b.a_id ORDER BY exe_ctx_b.id ASC",
);
assert.deepEqual(readerBeforeCommit.rows, [
  { "exe_ctx_a.id": 1, "exe_ctx_a.v": 10, "exe_ctx_b.id": 1, "exe_ctx_b.tag": "old" },
]);

await writer.execute("COMMIT");

const readerAfterCommit = await reader.query(
  "SELECT exe_ctx_a.id, exe_ctx_a.v, exe_ctx_b.id, exe_ctx_b.tag FROM exe_ctx_a INNER JOIN exe_ctx_b ON exe_ctx_a.id = exe_ctx_b.a_id ORDER BY exe_ctx_b.id ASC",
);
assert.deepEqual(readerAfterCommit.rows, [
  { "exe_ctx_a.id": 1, "exe_ctx_a.v": 11, "exe_ctx_b.id": 1, "exe_ctx_b.tag": "old" },
  { "exe_ctx_a.id": 1, "exe_ctx_a.v": 11, "exe_ctx_b.id": 2, "exe_ctx_b.tag": "new" },
]);

console.log("ok: P2-EXE-001 execution pipeline uses RC + own-write transaction context");
