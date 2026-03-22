import {
  appendP4Boot002TrackingSample,
  P4_BOOT_002_HISTORY_PATH,
  P4_BOOT_002_REPORT_PATH,
  runP4Boot002PerformanceBaseline,
  writeP4Boot002PerformanceReport,
} from "../test/benchmark/p4-boot-002-performance-baseline.js";

const reportPath = process.argv[2] ?? P4_BOOT_002_REPORT_PATH;
const historyPath = process.argv[3] ?? P4_BOOT_002_HISTORY_PATH;

const report = await runP4Boot002PerformanceBaseline();
const withPaths = {
  ...report,
  tracking: {
    ...report.tracking,
    reportPath,
    historyPath,
  },
};

await writeP4Boot002PerformanceReport(reportPath, withPaths);
const trackingSample = await appendP4Boot002TrackingSample(historyPath, withPaths);

console.log("p4-boot-002 performance baseline ok", {
  reportPath,
  historyPath,
  windowThroughputQps: withPaths.windowFunction.performance.throughputOpsPerSec,
  windowP95LatencyMs: withPaths.windowFunction.performance.p95LatencyMs,
  recursiveCteRejectOpsPerSec: withPaths.recursiveCte.performance.throughputOpsPerSec,
  dynamicSqlRejectOpsPerSec: withPaths.dynamicSql.performance.throughputOpsPerSec,
  trackingAt: trackingSample.at,
});
