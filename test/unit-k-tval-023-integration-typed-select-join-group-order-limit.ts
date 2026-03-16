import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute("CREATE TABLE users_k23 (id INT PRIMARY KEY, team_id INT, amount INT, active BOOLEAN)");
await db.execute("CREATE TABLE teams_k23 (id INT PRIMARY KEY, tier INT)");

await db.execute("INSERT INTO teams_k23 (id, tier) VALUES (1, 10)");
await db.execute("INSERT INTO teams_k23 (id, tier) VALUES (2, 20)");

await db.execute("INSERT INTO users_k23 (id, team_id, amount, active) VALUES (1, 1, 10, true)");
await db.execute("INSERT INTO users_k23 (id, team_id, amount, active) VALUES (2, 1, 15, true)");
await db.execute("INSERT INTO users_k23 (id, team_id, amount, active) VALUES (3, 2, 8, true)");
await db.execute("INSERT INTO users_k23 (id, team_id, amount, active) VALUES (4, 2, 12, false)");
await db.execute("INSERT INTO users_k23 (id, team_id, amount, active) VALUES (5, 2, 20, true)");

const top = await db.query(
  "SELECT teams_k23.tier, SUM(users_k23.amount) "
  + "FROM users_k23 INNER JOIN teams_k23 ON users_k23.team_id = teams_k23.id "
  + "WHERE users_k23.active = 'true' AND users_k23.amount >= '10' "
  + "GROUP BY teams_k23.tier HAVING sum >= '20' ORDER BY sum DESC, teams_k23.tier ASC LIMIT 1",
);
assert.deepEqual(top.rows, [{ "teams_k23.tier": 10, sum: 25 }]);

const second = await db.query(
  "SELECT teams_k23.tier, SUM(users_k23.amount) "
  + "FROM users_k23 INNER JOIN teams_k23 ON users_k23.team_id = teams_k23.id "
  + "WHERE users_k23.active = 'true' AND users_k23.amount >= '10' "
  + "GROUP BY teams_k23.tier HAVING sum >= '20' ORDER BY sum DESC, teams_k23.tier ASC LIMIT 1 OFFSET 1",
);
assert.deepEqual(second.rows, [{ "teams_k23.tier": 20, sum: 20 }]);

console.log("ok: K-TVAL-023 integration typed SELECT/JOIN/GROUP/HAVING/ORDER/LIMIT");
