import { runTpccLikeMiniBenchmark, writeTpccLikeBenchReport } from "../test/benchmark/p2-benchmarks.js";

const outputPath = process.argv[2] ?? "reports/sql-tpcc-like-benchmark.json";
const warehousesArg = Number(process.argv[3] ?? "0");
const districtsArg = Number(process.argv[4] ?? "0");
const customersArg = Number(process.argv[5] ?? "0");
const ordersArg = Number(process.argv[6] ?? "0");

const report = await runTpccLikeMiniBenchmark({
  warehouses: Number.isFinite(warehousesArg) && warehousesArg > 0 ? warehousesArg : undefined,
  districtsPerWarehouse: Number.isFinite(districtsArg) && districtsArg > 0 ? districtsArg : undefined,
  customersPerDistrict: Number.isFinite(customersArg) && customersArg > 0 ? customersArg : undefined,
  ordersPerDistrict: Number.isFinite(ordersArg) && ordersArg > 0 ? ordersArg : undefined,
});

await writeTpccLikeBenchReport(outputPath, report);

const sample = report.samples[0];
console.log(`written: ${outputPath}`);
console.log(`sample=${sample?.name}, ops=${sample?.operations}, durationMs=${sample?.durationMs}, opsPerSec=${sample?.opsPerSec}`);
console.log(`notes=${(report.notes ?? []).join("; ")}`);
