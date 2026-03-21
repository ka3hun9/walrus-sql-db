import { runP2ConflictBenchmark, writeP2BenchReport } from "../src/p2-benchmarks.js";

const report = await runP2ConflictBenchmark({ rounds: 40 });
await writeP2BenchReport("reports/p2-bench-002-conflict-throughput.json", report);
console.log("p2-bench-conflict ok", report.samples[0]);
