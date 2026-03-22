import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTpccLikeMiniBenchmark, writeTpccLikeBenchReport } from "./benchmark/p2-benchmarks.js";

const dir = await mkdtemp(join(tmpdir(), "walrus-sql-p2-bench-002-"));
const reportPath = join(dir, "tpcc-conflict-baseline.json");

try {
  const report = await runTpccLikeMiniBenchmark({
    warehouses: 1,
    districtsPerWarehouse: 1,
    customersPerDistrict: 40,
    ordersPerDistrict: 80,
    linesPerOrder: 2,
  });
  await writeTpccLikeBenchReport(reportPath, report);

  const loaded = JSON.parse(await readFile(reportPath, "utf8")) as typeof report;
  const sample = loaded.samples[0]!;
  assert.equal(sample.name, "p2_tpcc_mini_new_order");
  assert.ok(sample.operations > 0);
  assert.ok(sample.opsPerSec > 0);
  assert.ok((sample.avgLatencyMs ?? 0) >= 0);
  assert.ok(Array.isArray(loaded.notes));
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("ok: P2-BENCH-002 conflict throughput/latency baseline report");
