import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE bench_btree_users (id INT PRIMARY KEY, score INT, payload TEXT)");

const total = 4000;
for (let i = 1; i <= total; i++) {
  const score = i % 97 === 0 ? "NULL" : `${i % 1000}`;
  await db.execute(`INSERT INTO bench_btree_users (id, score, payload) VALUES (${i}, ${score}, 'u${i}')`);
}

await db.execute("CREATE INDEX idx_bench_btree_score ON bench_btree_users(score)");

const sql =
  "SELECT id, score FROM bench_btree_users WHERE score >= 300 AND score < 700 ORDER BY score ASC LIMIT 200";
const rounds = 40;
let sampledRows = 0;

const started = performance.now();
for (let i = 0; i < rounds; i++) {
  const rows = (await db.query(sql)).rows;
  sampledRows = rows.length;
  assert.ok(rows.length > 0);
  for (let j = 1; j < rows.length; j++) {
    const prev = Number(rows[j - 1]?.score ?? 0);
    const curr = Number(rows[j]?.score ?? 0);
    assert.ok(prev <= curr);
  }
}
const elapsedMs = performance.now() - started;

const stats = db.getBtreeIndexStats("bench_btree_users");
assert.equal(stats.length, 1);
assert.ok((stats[0]?.rowsIndexed ?? 0) > 0);

const report = {
  benchmark: "p3-idx-004-btree-range-order-path",
  at: new Date().toISOString(),
  totalRows: total,
  queryRounds: rounds,
  sampledRows,
  elapsedMs: Number(elapsedMs.toFixed(3)),
};

const outPath = resolve("reports", "p3-idx-004-btree-index-bench.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`ok: bench written -> ${outPath}`);
