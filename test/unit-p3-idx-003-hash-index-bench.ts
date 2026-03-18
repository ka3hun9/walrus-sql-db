import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { WalrusSqlClient } from "../src/client.js";

async function runCase(enableHashPath: boolean): Promise<number> {
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
  await db.execute("CREATE TABLE bench_hash_users (id INT PRIMARY KEY, email TEXT, age INT)");

  const total = 5000;
  for (let i = 1; i <= total; i++) {
    const email = i % 10 === 0 ? "hit@example.com" : `u${i}@example.com`;
    await db.execute(`INSERT INTO bench_hash_users (id, email, age) VALUES (${i}, '${email}', ${18 + (i % 40)})`);
  }

  const sql = "SELECT id,email FROM bench_hash_users WHERE email = 'hit@example.com'";
  const rounds = 50;

  const started = performance.now();
  for (let i = 0; i < rounds; i++) {
    const rows = (await db.query(sql)).rows;
    assert.ok(rows.length > 0);
  }
  const elapsedMs = performance.now() - started;

  const stats = db.getHashIndexStats("bench_hash_users");
  const hasIndexBuilt = stats.length > 0 && stats[0]!.rowsIndexed > 0;
  if (enableHashPath) assert.ok(hasIndexBuilt);

  return elapsedMs;
}

const elapsed = await runCase(true);

const report = {
  benchmark: "p3-idx-003-hash-index-equality-path",
  at: new Date().toISOString(),
  queryRounds: 50,
  elapsedMs: Number(elapsed.toFixed(3)),
};

const outPath = resolve("reports", "p3-idx-003-hash-index-bench.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`ok: bench written -> ${outPath}`);
