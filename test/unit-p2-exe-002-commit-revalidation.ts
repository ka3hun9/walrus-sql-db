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
  dst.tableVersionObjects = src.tableVersionObjects;
};

const writer = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});
const racer = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  isolationLevel: "read_committed",
  readCache: { enabled: false },
});
shareCommittedStore(writer, racer);

await writer.execute("CREATE TABLE exe002_u (id INT PRIMARY KEY, email TEXT UNIQUE)");
await writer.execute("BEGIN");
await writer.execute("INSERT INTO exe002_u (id, email) VALUES (1, 'dup@x.com')");
await racer.execute("INSERT INTO exe002_u (id, email) VALUES (2, 'dup@x.com')");

await assert.rejects(
  writer.execute("COMMIT"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY: Duplicate key value .* COMMIT revalidation/,
);
await writer.execute("ROLLBACK");

await writer.execute("CREATE TABLE exe002_p (id INT PRIMARY KEY)");
await writer.execute("CREATE TABLE exe002_c (id INT PRIMARY KEY, parent_id INT REFERENCES exe002_p(id))");
await writer.execute("INSERT INTO exe002_p (id) VALUES (1)");

await writer.execute("BEGIN");
await writer.execute("INSERT INTO exe002_c (id, parent_id) VALUES (1, 1)");
await racer.execute("DELETE FROM exe002_p WHERE id = 1");

await assert.rejects(
  writer.execute("COMMIT"),
  /ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY: referential integrity failed/,
);
await writer.execute("ROLLBACK");

const finalParent = await writer.query("SELECT * FROM exe002_p");
const finalChild = await writer.query("SELECT * FROM exe002_c");
assert.deepEqual(finalParent.rows, []);
assert.deepEqual(finalChild.rows, []);

console.log("ok: P2-EXE-002 commit-point constraint revalidation");
