import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

const reportPath = process.argv[2] ?? "reports/p3-idx-003-hash-eq.json";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_idx_bench_users (id INT PRIMARY KEY, email TEXT UNIQUE, name TEXT)");
for (let i = 1; i <= 5000; i++) {
  await db.execute(`INSERT INTO p3_idx_bench_users (id, email, name) VALUES (${i}, 'u${i}@ex.com', 'name_${i % 100}')`);
}

const runMany = async (sql: string, n: number) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await db.query(sql);
  const t1 = performance.now();
  return Number((t1 - t0).toFixed(3));
};

const rounds = 200;
const indexedSql = "SELECT id FROM p3_idx_bench_users WHERE email = 'u4242@ex.com'";
const nonIndexedSql = "SELECT id FROM p3_idx_bench_users WHERE name = 'name_42'";

const indexedMs = await runMany(indexedSql, rounds);
const nonIndexedMs = await runMany(nonIndexedSql, rounds);

const report = {
  item: "P3-IDX-003",
  generatedAt: new Date().toISOString(),
  rounds,
  datasetRows: 5000,
  indexedSql,
  nonIndexedSql,
  indexedTotalMs: indexedMs,
  nonIndexedTotalMs: nonIndexedMs,
  speedupApprox: nonIndexedMs > 0 ? Number((nonIndexedMs / indexedMs).toFixed(2)) : null,
  hashIndexStats: db.getHashIndexStats("p3_idx_bench_users"),
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`ok: wrote ${reportPath}`);
