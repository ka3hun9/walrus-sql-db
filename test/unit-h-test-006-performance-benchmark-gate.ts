import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { runPerformanceBenchmarks, writePerformanceBenchmarkReport } from "../test/benchmark/performance-benchmarks.js";

const report = await runPerformanceBenchmarks({
  writeRows: 300,
  coldQueries: 1,
  hotQueries: 200,
});

const byName = new Map(report.samples.map((sample) => [sample.name, sample]));

assert.equal(report.samples.length, 3);
assert.equal(byName.has("write_throughput"), true);
assert.equal(byName.has("cold_query_throughput"), true);
assert.equal(byName.has("hot_query_throughput"), true);

for (const sample of report.samples) {
  assert.ok(sample.operations > 0);
  assert.ok(sample.durationMs >= 0);
  assert.ok(sample.opsPerSec >= 0);
}

const outPath = "reports/sql-performance-benchmark-h-test-006.json";
await writePerformanceBenchmarkReport(outPath, report);
const raw = await fs.readFile(outPath, "utf8");
const parsed = JSON.parse(raw) as {
  config?: { writeRows?: number; coldQueries?: number; hotQueries?: number };
  samples?: Array<{ name?: string }>;
};

assert.equal(parsed.config?.writeRows, 300);
assert.equal(parsed.config?.coldQueries, 1);
assert.equal(parsed.config?.hotQueries, 200);
assert.equal(parsed.samples?.length, 3);
assert.deepEqual(
  (parsed.samples ?? []).map((sample) => sample.name).sort(),
  ["cold_query_throughput", "hot_query_throughput", "write_throughput"],
);

console.log("ok: H-TEST-006 performance benchmark gate (cold/hot query + write throughput)");
