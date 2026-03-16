import { runTpccLikeBenchmark, writeTpccLikeBenchmarkReport } from "../src/p2-benchmarks.js";

const outputPath = process.argv[2] ?? "reports/sql-tpcc-like-benchmark.json";
const txCountArg = Number(process.argv[3] ?? "0");
const conflictEveryArg = Number(process.argv[4] ?? "0");
const customersArg = Number(process.argv[5] ?? "0");

const report = await runTpccLikeBenchmark({
  transactions: Number.isFinite(txCountArg) && txCountArg > 0 ? txCountArg : undefined,
  conflictEvery: Number.isFinite(conflictEveryArg) && conflictEveryArg >= 0 ? conflictEveryArg : undefined,
  customersPerWarehouse: Number.isFinite(customersArg) && customersArg > 0 ? customersArg : undefined,
});

await writeTpccLikeBenchmarkReport(outputPath, report);

console.log(`written: ${outputPath}`);
console.log(`tx attempted=${report.attemptedTransactions}, committed=${report.committedTransactions}, aborted=${report.abortedTransactions}`);
console.log(`throughput tps=${report.throughputTps}, latency(avg/p95/max)=${report.latencyMs.avg}/${report.latencyMs.p95}/${report.latencyMs.max}`);
console.log(`consistency errors=${report.consistencyErrors.length}`);
