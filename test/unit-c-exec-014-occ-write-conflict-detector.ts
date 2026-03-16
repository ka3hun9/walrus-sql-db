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

const sessionA = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});
const sessionB = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

shareCommittedStore(sessionA, sessionB);

await sessionA.execute("CREATE TABLE iso_occ (id INT PRIMARY KEY, v INT)");
await sessionA.execute("INSERT INTO iso_occ (id, v) VALUES (1, 10)");

await sessionA.execute("BEGIN");
await sessionB.execute("BEGIN");

await sessionA.execute("UPDATE iso_occ SET v = 11 WHERE id = 1");
await sessionB.execute("UPDATE iso_occ SET v = 12 WHERE id = 1");

await sessionA.execute("COMMIT");

await assert.rejects(
  sessionB.execute("COMMIT"),
  /ERR_CONSTRAINT_VIOLATION:WRITE_CONFLICT:/,
);

assert.equal(sessionB.getTransactionState(), "aborted");
await sessionB.execute("ROLLBACK");
assert.equal(sessionB.getTransactionState(), "idle");

const finalRows = await sessionA.query("SELECT id, v FROM iso_occ");
assert.deepEqual(finalRows.rows, [{ id: 1, v: 11 }]);

console.log("ok: C-EXEC-014 OCC write conflict detector");
