import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_hash_users (id INT PRIMARY KEY, email TEXT, age INT)");
await db.execute("INSERT INTO idx_hash_users (id, email, age) VALUES (1, 'a@x.com', 18)");
await db.execute("INSERT INTO idx_hash_users (id, email, age) VALUES (2, 'b@x.com', 20)");
await db.execute("INSERT INTO idx_hash_users (id, email, age) VALUES (3, 'a@x.com', 22)");

{
  const rows = (await db.query("SELECT id,email,age FROM idx_hash_users WHERE email = 'a@x.com' ORDER BY id ASC")).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, 1);
  assert.equal(rows[1]?.id, 3);
}

{
  const stats = db.getHashIndexStats("idx_hash_users");
  assert.equal(stats.length, 1);
  assert.ok((stats[0]?.keys ?? 0) >= 2);
  assert.ok((stats[0]?.rowsIndexed ?? 0) >= 3);
}

{
  const log = db.getStorageWriteLog("idx_hash_users");
  assert.ok(log.some((evt) => evt.op === "INDEX_REBUILD"));
}

console.log("ok: P3-IDX-003 hash index structure + equality path");
