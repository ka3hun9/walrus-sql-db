import { runTpccLikeConflictBenchmark, writeTpccLikeBenchReport } from "../test/benchmark/p2-benchmarks.js";

const report = await runTpccLikeConflictBenchmark({ rounds: 40 });
await writeTpccLikeBenchReport("reports/p2-bench-002-conflict-throughput.json", report);
console.log("p2-bench-conflict ok", report.samples[0]);
