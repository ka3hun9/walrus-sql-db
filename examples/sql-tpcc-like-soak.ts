import { runTpccLikeSoakBenchmark, writeTpccLikeSoakReport } from "../src/p2-benchmarks.js";

const outputPath = process.argv[2] ?? "reports/sql-tpcc-like-soak.json";
const durationArg = Number(process.argv[3] ?? "0");
const durationMs = Number.isFinite(durationArg) && durationArg > 0 ? durationArg : 60_000;

const report = await runTpccLikeSoakBenchmark({
  durationMs,
  runConfig: {
    transactions: 200,
    conflictEvery: 4,
    customersPerWarehouse: 120,
  },
});

await writeTpccLikeSoakReport(outputPath, report);

console.log(`written: ${outputPath}`);
console.log(`runs=${report.runs}, attempted=${report.totalAttempted}, committed=${report.totalCommitted}, aborted=${report.totalAborted}`);
console.log(`conflicts=${report.totalConflicts}, consistencyErrors=${report.consistencyErrors.length}`);
