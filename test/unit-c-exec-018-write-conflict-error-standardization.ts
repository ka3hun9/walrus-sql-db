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

const s1 = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});
const s2 = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});

shareCommittedStore(s1, s2);

await s1.execute("CREATE TABLE iso_conf_err (id INT PRIMARY KEY, v INT)");
await s1.execute("INSERT INTO iso_conf_err (id, v) VALUES (1, 1)");

await s1.execute("BEGIN");
await s2.execute("BEGIN");
await s1.execute("UPDATE iso_conf_err SET v = 2 WHERE id = 1");
await s2.execute("UPDATE iso_conf_err SET v = 3 WHERE id = 1");

await s1.execute("COMMIT");

await assert.rejects(
  s2.execute("COMMIT"),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("ERR_CONSTRAINT_VIOLATION:WRITE_CONFLICT:")
      && msg.includes("clause=COMMIT")
      && msg.includes('token=iso_conf_err:{"id":1}')
    );
  },
);

console.log("ok: C-EXEC-018 write conflict error standardization");
