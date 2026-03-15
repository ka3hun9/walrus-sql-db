import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: true, maxEntries: 512, ttlMs: 60_000 },
});

await db.execute("CREATE TABLE raw_consistency (id INT PRIMARY KEY, v INT)");
for (let id = 1; id <= 50; id++) {
  await db.execute(`INSERT INTO raw_consistency (id, v) VALUES (${id}, 0)`);
}

// Warm read cache before update loops.
await db.query("SELECT id, v FROM raw_consistency ORDER BY id");

for (let i = 1; i <= 200; i++) {
  const id = (i % 50) + 1;
  await db.execute(`UPDATE raw_consistency SET v = ${i} WHERE id = ${id}`);
  const q = await db.query(`SELECT v FROM raw_consistency WHERE id = ${id}`);
  assert.equal(q.rows[0]?.v, i);
}

await Promise.all(
  Array.from({ length: 50 }, (_, idx) => idx + 1).map(async (id) => {
    await db.execute(`UPDATE raw_consistency SET v = ${1000 + id} WHERE id = ${id}`);
    const q = await db.query(`SELECT v FROM raw_consistency WHERE id = ${id}`);
    assert.equal(q.rows[0]?.v, 1000 + id);
  }),
);

await db.execute("DELETE FROM raw_consistency WHERE id = 1");
{
  const q = await db.query("SELECT id FROM raw_consistency WHERE id = 1");
  assert.equal(q.rows.length, 0);
}

await db.execute("INSERT INTO raw_consistency (id, v) VALUES (1, 777)");
{
  const q = await db.query("SELECT v FROM raw_consistency WHERE id = 1");
  assert.equal(q.rows[0]?.v, 777);
}

console.log("ok: G-STOR-004 read-after-write consistency under interleaved writes");
