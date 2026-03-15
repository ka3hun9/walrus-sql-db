import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_addc (id INT PRIMARY KEY, name TEXT)");
await db.execute("INSERT INTO users_addc (id, name) VALUES (1, 'Alice')");

await assert.rejects(
  db.execute("ALTER TABLE users_addc ADD COLUMN tier INT NOT NULL"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL_ADD_COLUMN/,
);

await assert.rejects(
  db.execute("ALTER TABLE users_addc ADD COLUMN bad_tier INT NOT NULL DEFAULT NULL"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL_ADD_COLUMN/,
);

await db.execute("ALTER TABLE users_addc ADD COLUMN tier INT NOT NULL DEFAULT 1");
await db.execute("ALTER TABLE users_addc ADD COLUMN tag TEXT DEFAULT 'guest'");

await db.execute("INSERT INTO users_addc (id, name) VALUES (2, 'Bob')");
await db.execute("INSERT INTO users_addc (id, name, tier, tag) VALUES (3, 'Cara', 5, 'vip')");

const q = await db.query("SELECT id, tier, tag FROM users_addc ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.tier, row.tag]),
  [
    [1, 1, "guest"],
    [2, 1, "guest"],
    [3, 5, "vip"],
  ],
);

console.log("ok: E-DDL-002 ALTER TABLE ADD COLUMN default / NOT NULL conflict handling");
