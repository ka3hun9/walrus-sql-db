import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_k14_create (id INT PRIMARY KEY, score INT DEFAULT '7')");
await db.execute("INSERT INTO t_k14_create (id) VALUES (1)");
const created = await db.query("SELECT id, score FROM t_k14_create ORDER BY id");
assert.deepEqual(created.rows, [{ id: 1, score: 7 }]);

await db.execute("CREATE TABLE t_k14_alter (id INT PRIMARY KEY)");
await db.execute("INSERT INTO t_k14_alter (id) VALUES (1)");
await db.execute("ALTER TABLE t_k14_alter ADD COLUMN tag CHAR(3) DEFAULT 'a'");
await db.execute("ALTER TABLE t_k14_alter ADD COLUMN note VARCHAR(4) DEFAULT 'xy'");

const altered = await db.query("SELECT id, tag, note FROM t_k14_alter ORDER BY id");
assert.deepEqual(altered.rows, [{ id: 1, tag: "a  ", note: "xy" }]);

console.log("ok: K-TVAL-014 typed DEFAULT + ALTER ADD COLUMN backfill");
