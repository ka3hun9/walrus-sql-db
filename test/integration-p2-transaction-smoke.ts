import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute("CREATE TABLE p2_integration_tx (id INT PRIMARY KEY, amount INT)");

await db.execute("BEGIN");
await db.execute("INSERT INTO p2_integration_tx (id, amount) VALUES (1, 100)");
await db.execute("ROLLBACK");

let out = await db.query("SELECT COUNT(*) FROM p2_integration_tx");
assert.equal(Number(out.rows[0]?.count ?? -1), 0);

await db.execute("BEGIN");
await db.execute("INSERT INTO p2_integration_tx (id, amount) VALUES (1, 100)");
await db.execute("COMMIT");

out = await db.query("SELECT COUNT(*) FROM p2_integration_tx");
assert.equal(Number(out.rows[0]?.count ?? -1), 1);

console.log("ok: integration P2 transaction smoke");
