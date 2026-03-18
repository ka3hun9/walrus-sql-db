import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_idx_users (id INT PRIMARY KEY, email TEXT UNIQUE, name TEXT)");

for (let i = 1; i <= 200; i++) {
  await db.execute(`INSERT INTO p3_idx_users (id, email, name) VALUES (${i}, 'u${i}@ex.com', 'n${i}')`);
}

{
  const out = await db.query("SELECT id, email FROM p3_idx_users WHERE email = 'u123@ex.com'");
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]?.id, 123);
  assert.equal(out.rows[0]?.email, "u123@ex.com");
}

{
  const stats = db.getHashIndexStats("p3_idx_users");
  assert.equal(stats.length, 1);
  assert.ok(stats[0]!.keys > 0);
  assert.ok(stats[0]!.rowsIndexed >= 200);
}

{
  const out = await db.query("SELECT id FROM p3_idx_users WHERE email = 'u999@ex.com'");
  assert.equal(out.rows.length, 0);
}

console.log("ok: P3-IDX-003 hash index equality query path");
