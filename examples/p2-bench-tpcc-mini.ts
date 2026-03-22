import { runTpccLikeMiniBenchmark, writeTpccLikeBenchReport } from "../test/benchmark/p2-benchmarks.js";

const report = await runTpccLikeMiniBenchmark({
  warehouses: 1,
  districtsPerWarehouse: 2,
  customersPerDistrict: 20,
  ordersPerDistrict: 20,
  linesPerOrder: 3,
});

await writeTpccLikeBenchReport("reports/p2-bench-001-tpcc-mini.json", report);
console.log("p2-bench-tpcc-mini ok", report.samples[0]);
