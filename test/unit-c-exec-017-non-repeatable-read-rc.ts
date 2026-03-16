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

await sessionA.execute("CREATE TABLE iso_nrr (id INT PRIMARY KEY, v INT)");
await sessionA.execute("INSERT INTO iso_nrr (id, v) VALUES (1, 10)");

await sessionA.execute("BEGIN");
const firstRead = await sessionA.query("SELECT v FROM iso_nrr WHERE id = 1");
assert.deepEqual(firstRead.rows, [{ v: 10 }]);

await sessionB.execute("BEGIN");
await sessionB.execute("UPDATE iso_nrr SET v = 20 WHERE id = 1");
await sessionB.execute("COMMIT");

const secondRead = await sessionA.query("SELECT v FROM iso_nrr WHERE id = 1");
assert.deepEqual(secondRead.rows, [{ v: 20 }]);

await sessionA.execute("ROLLBACK");

console.log("ok: C-EXEC-017 non-repeatable read allowed in READ COMMITTED");
