import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_obs_users (id INT PRIMARY KEY, score INT, email TEXT)");
await db.execute("CREATE INDEX idx_obs_score ON idx_obs_users(score)");

await db.execute("INSERT INTO idx_obs_users (id, score, email) VALUES (1, 10, 'u1')");
await db.execute("INSERT INTO idx_obs_users (id, score, email) VALUES (2, 20, 'u2')");
await db.execute("UPDATE idx_obs_users SET score = 15 WHERE id = 1");
await db.execute("DELETE FROM idx_obs_users WHERE id = 2");

await db.query("SELECT id FROM idx_obs_users WHERE id = 1");
await db.query("SELECT id FROM idx_obs_users WHERE id = 999");
await db.query("SELECT id, score FROM idx_obs_users WHERE score >= 10 ORDER BY score ASC");
await db.query("SELECT id, score FROM idx_obs_users WHERE score > 999 ORDER BY score ASC");

const stats = db.getIndexObservability("idx_obs_users");
assert.equal(stats.length, 1);
const obs = stats[0]!;

assert.ok(obs.lookupCount >= 4);
assert.ok(obs.lookupHits >= 1);
assert.ok(obs.lookupMisses >= 1);
assert.ok(obs.hitRate >= 0 && obs.hitRate <= 1);
assert.ok(obs.failureRate >= 0 && obs.failureRate <= 1);

assert.ok(obs.maintenanceInsertOps >= 2);
assert.ok(obs.maintenanceUpdateOps >= 1);
assert.ok(obs.maintenanceDeleteOps >= 1);
assert.ok(obs.maintenanceRebuildOps >= 1);
assert.ok(obs.maintenanceRows >= 4);

console.log("ok: P3-IDX-008 index observability metrics");
