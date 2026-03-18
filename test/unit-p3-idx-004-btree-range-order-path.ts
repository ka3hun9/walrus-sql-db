import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_btree_users (id INT PRIMARY KEY, score INT, name TEXT)");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (1, 10, 'u1')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (2, 20, 'u2')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (3, 30, 'u3')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (4, 30, 'u4')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (5, 40, 'u5')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (6, NULL, 'u6')");
await db.execute("INSERT INTO idx_btree_users (id, score, name) VALUES (7, 50, 'u7')");

await db.execute("CREATE INDEX idx_btree_score ON idx_btree_users(score)");

{
  const catalog = db.getIndexCatalog("idx_btree_users");
  const idx = catalog.find((entry) => entry.name === "IDX_BTREE_SCORE");
  assert.ok(idx);
  assert.equal(idx?.type, "BTREE");
  assert.equal(idx?.status, "ACTIVE");
}

{
  const rows = (await db.query(
    "SELECT id, score FROM idx_btree_users WHERE score >= 20 AND score < 50 ORDER BY score ASC",
  )).rows;
  assert.deepEqual(rows.map((row) => row.id), [2, 3, 4, 5]);
}

{
  const rows = (await db.query(
    "SELECT id, score FROM idx_btree_users WHERE score > 20 AND score < 40 ORDER BY score ASC",
  )).rows;
  assert.deepEqual(rows.map((row) => row.id), [3, 4]);
}

{
  const rows = (await db.query("SELECT id, score FROM idx_btree_users ORDER BY score DESC")).rows;
  assert.deepEqual(rows.map((row) => row.id), [7, 5, 3, 4, 2, 1, 6]);
}

{
  const rows = (await db.query(
    "SELECT id, score FROM idx_btree_users WHERE score >= 20 ORDER BY score ASC LIMIT 3",
  )).rows;
  assert.deepEqual(rows.map((row) => row.id), [2, 3, 4]);
}

{
  const stats = db.getBtreeIndexStats("idx_btree_users");
  assert.equal(stats.length, 1);
  assert.ok((stats[0]?.keys ?? 0) >= 5);
  assert.ok((stats[0]?.rowsIndexed ?? 0) >= 6);
}

await db.execute("DROP INDEX idx_btree_score ON idx_btree_users");
{
  const catalog = db.getIndexCatalog("idx_btree_users");
  assert.ok(!catalog.some((entry) => entry.name === "IDX_BTREE_SCORE"));
  assert.equal(db.getBtreeIndexStats("idx_btree_users").length, 0);
}

console.log("ok: P3-IDX-004 btree range/order query path");
