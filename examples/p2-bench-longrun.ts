import { runTpccLikeLongRunStability, writeTpccLikeBenchReport } from "../test/benchmark/p2-benchmarks.js";

const report = await runTpccLikeLongRunStability({ durationMs: 12_000, writeEveryMs: 25 });
await writeTpccLikeBenchReport("reports/p2-bench-003-longrun-stability.json", report);
console.log("p2-bench-longrun ok", report.samples[0], report.notes);
