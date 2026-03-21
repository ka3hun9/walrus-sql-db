import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import {
  evaluateTypedValuePerformanceRegression,
  runPerformanceBenchmarks,
  type PerformanceBenchmarkReport,
} from "../test/benchmark/performance-benchmarks.js";

const baselinePath = "test/fixtures/k-tval-020-performance-baseline.json";
const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as PerformanceBenchmarkReport;
const current = await runPerformanceBenchmarks({
  writeRows: baseline.config.writeRows,
  coldQueries: baseline.config.coldQueries,
  hotQueries: baseline.config.hotQueries,
});

const gate = evaluateTypedValuePerformanceRegression(current, baseline);
assert.equal(gate.checks.length, 3, "typed value perf gate should evaluate write/cold/hot samples");
assert.equal(gate.passed, true, `typed value perf gate failed: ${JSON.stringify(gate.checks)}`);

const degraded: PerformanceBenchmarkReport = {
  ...current,
  samples: current.samples.map((sample) => ({
    ...sample,
    opsPerSec: Number((sample.opsPerSec * 0.0001).toFixed(4)),
  })),
};
const degradedGate = evaluateTypedValuePerformanceRegression(degraded, baseline);
assert.equal(degradedGate.passed, false, "gate should fail when throughput collapses far below threshold");
assert.ok(degradedGate.checks.some((check) => !check.pass), "at least one perf sample should fail in degraded scenario");

console.log("ok: K-TVAL-020 typed value performance regression gate");
