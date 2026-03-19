import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_obj_users (id INT PRIMARY KEY, score INT, email TEXT)");
await db.execute("INSERT INTO idx_obj_users (id, score, email) VALUES (1, 10, 'u1')");
await db.execute("INSERT INTO idx_obj_users (id, score, email) VALUES (2, 20, 'u2')");
await db.execute("CREATE INDEX idx_obj_score ON idx_obj_users(score)");

await db.execute("BEGIN");
await db.execute("UPDATE idx_obj_users SET score = 15 WHERE id = 1");
await db.execute("INSERT INTO idx_obj_users (id, score, email) VALUES (3, 30, 'u3')");
await db.execute("COMMIT");

await db.execute("BEGIN");
await db.execute("UPDATE idx_obj_users SET score = 25 WHERE id = 2");
await db.execute("DELETE FROM idx_obj_users WHERE id = 1");
await db.execute("COMMIT");

const scoreHistory = db.getIndexVersionObjects("idx_obj_score");
assert.ok(Array.isArray(scoreHistory));
assert.equal(scoreHistory.length, 3);
assert.equal(scoreHistory[0]?.prevVersion, null);
assert.equal(scoreHistory[0]?.currentVersion, 1);
assert.equal(scoreHistory[1]?.prevVersion, 1);
assert.equal(scoreHistory[1]?.currentVersion, 2);
assert.equal(scoreHistory[2]?.prevVersion, 2);
assert.equal(scoreHistory[2]?.currentVersion, 3);
assert.equal(scoreHistory[2]?.indexType, "BTREE");
assert.equal(scoreHistory[2]?.payload.indexType, "BTREE");
assert.ok((scoreHistory[2]?.payload.entries.length ?? 0) > 0);
assert.ok(typeof scoreHistory[2]?.payload.entries[0]?.rowKeys[0] === "string");

const tableHistory = db.getTableVersionObjects("idx_obj_users");
assert.ok(Array.isArray(tableHistory));
assert.equal(tableHistory.length, 2);
const tableObjectIds = new Set(tableHistory.map((object) => object.objectId));
assert.ok(scoreHistory.every((object) => !tableObjectIds.has(object.objectId)));
assert.ok(scoreHistory.every((object) => !("rows" in object)));

const internals = db as unknown as {
  tables: Map<string, Array<Record<string, unknown>>>;
  hashIndexes: Map<string, unknown>;
  hashIndexStats: Map<string, unknown>;
  btreeIndexes: Map<string, unknown>;
  btreeIndexStats: Map<string, unknown>;
};
internals.tables.set("idx_obj_users", [{ id: 99, score: 999, email: "corrupted" }]);
internals.hashIndexes.delete("idx_obj_users");
internals.hashIndexStats.delete("idx_obj_users");
internals.btreeIndexes.delete("idx_obj_users");
internals.btreeIndexStats.delete("idx_obj_users");

const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: "rollback" });
assert.equal(recovery.strategy, "rollback");
assert.ok(recovery.restoredTables.includes("idx_obj_users"));

const rows = (await db.query("SELECT id, score FROM idx_obj_users ORDER BY id ASC")).rows;
assert.deepEqual(rows, [
  { id: 2, score: 25 },
  { id: 3, score: 30 },
]);

const btreeStats = db.getBtreeIndexStats("idx_obj_users");
assert.equal(btreeStats.length, 1);
assert.ok((btreeStats[0]?.rowsIndexed ?? 0) >= 2);

console.log("ok: P3-IDX-005 separated index object persistence + version chain");
