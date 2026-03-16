import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTpccLikeBenchmark, writeTpccLikeBenchmarkReport } from "../src/p2-benchmarks.js";

const dir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-bench-002-"));
const reportPath = join(dir, "tpcc-conflict-baseline.json");

try {
  const report = await runTpccLikeBenchmark({
    warehouses: 1,
    customersPerWarehouse: 40,
    transactions: 80,
    conflictEvery: 2,
    amountStep: 2,
  });
  await writeTpccLikeBenchmarkReport(reportPath, report);

  const loaded = JSON.parse(await readFile(reportPath, "utf8")) as typeof report;
  assert.equal(loaded.config.conflictEvery, 2);
  assert.ok(loaded.conflictsDetected > 0);
  assert.ok(loaded.abortedTransactions > 0);
  assert.ok(loaded.throughputTps > 0);
  assert.ok(loaded.latencyMs.p95 >= loaded.latencyMs.avg);
  assert.equal(loaded.consistencyErrors.length, 0);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("ok: P2-BENCH-002 conflict throughput/latency baseline report");
