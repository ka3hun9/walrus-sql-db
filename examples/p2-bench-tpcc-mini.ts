import { runP2TpccMiniBenchmark, writeP2BenchReport } from "../src/p2-benchmarks.js";

const report = await runP2TpccMiniBenchmark({
  warehouses: 1,
  districtsPerWarehouse: 2,
  customersPerDistrict: 20,
  ordersPerDistrict: 20,
  linesPerOrder: 3,
});

await writeP2BenchReport("reports/p2-bench-001-tpcc-mini.json", report);
console.log("p2-bench-tpcc-mini ok", report.samples[0]);
