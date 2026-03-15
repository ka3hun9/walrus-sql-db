import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { runPerformanceBenchmarks, writePerformanceBenchmarkReport } from "../src/performance-benchmarks.js";

const report = await runPerformanceBenchmarks({
  writeRows: 120,
  coldQueries: 1,
  hotQueries: 120,
});

assert.equal(report.samples.length, 3);
assert.deepEqual(
  report.samples.map((sample) => sample.name).sort(),
  ["cold_query_throughput", "hot_query_throughput", "write_throughput"],
);
for (const sample of report.samples) {
  assert.ok(sample.durationMs >= 0);
  assert.ok(sample.opsPerSec >= 0);
  assert.ok(sample.operations > 0);
}

const outputPath = "reports/sql-performance-benchmark-smoke.json";
await writePerformanceBenchmarkReport(outputPath, report);
const raw = await fs.readFile(outputPath, "utf8");
const parsed = JSON.parse(raw) as { samples?: unknown[] };
assert.equal(Array.isArray(parsed.samples), true);
assert.equal(parsed.samples?.length, 3);

console.log("ok: TST-P2-1 performance benchmarks");
