import { runTpccLikeLongRunStability, writeTpccLikeBenchReport } from "../test/benchmark/p2-benchmarks.js";

const outputPath = process.argv[2] ?? "reports/sql-tpcc-like-soak.json";
const durationArg = Number(process.argv[3] ?? "0");
const writeEveryArg = Number(process.argv[4] ?? "0");

const report = await runTpccLikeLongRunStability({
  durationMs: Number.isFinite(durationArg) && durationArg > 0 ? durationArg : 60_000,
  writeEveryMs: Number.isFinite(writeEveryArg) && writeEveryArg > 0 ? writeEveryArg : undefined,
});

await writeTpccLikeBenchReport(outputPath, report);

const sample = report.samples[0];
console.log(`written: ${outputPath}`);
console.log(`sample=${sample?.name}, ops=${sample?.operations}, durationMs=${sample?.durationMs}, opsPerSec=${sample?.opsPerSec}`);
console.log(`notes=${(report.notes ?? []).join("; ")}`);
