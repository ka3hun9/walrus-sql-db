import { WalrusSqlClient } from "../../src/client.js";

const REPORT_PATH = "reports/p4-bench-004-information-schema-stability.json";

interface BenchReport {
  timestamp: string;
  infoSchemaQuery: {
    tablesQueryMs: number;
    columnsQueryMs: number;
    constraintsQueryMs: number;
    throughputOpsPerSec: number;
  };
  stability: {
    tablesQueryStable: boolean;
    columnsQueryStable: boolean;
    constraintsQueryStable: boolean;
  };
}

async function runInfoSchemaBench(): Promise<BenchReport> {
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  // Set up tables and indexes
  await db.execute("CREATE TABLE t1 (id INT PRIMARY KEY, name TEXT)");
  await db.execute("CREATE TABLE t2 (id INT PRIMARY KEY, val INT)");
  await db.execute("CREATE INDEX idx_t2_val ON t2(val)");
  await db.execute("CREATE TABLE t3 (id INT PRIMARY KEY, ref_id INT, data TEXT)");

  const iterations = 100;
  const timestamps: number[] = [];

  // Benchmark information_schema.tables
  const tablesTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await db.query("SELECT table_name, table_type FROM information_schema.tables ORDER BY table_name");
    tablesTimes.push(performance.now() - start);
  }
  const avgTablesMs = tablesTimes.reduce((a, b) => a + b, 0) / tablesTimes.length;

  // Benchmark information_schema.columns
  const columnsTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await db.query("SELECT table_name, column_name, data_type FROM information_schema.columns ORDER BY table_name, ordinal_position");
    columnsTimes.push(performance.now() - start);
  }
  const avgColumnsMs = columnsTimes.reduce((a, b) => a + b, 0) / columnsTimes.length;

  // Benchmark information_schema.table_constraints
  const constraintsTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await db.query("SELECT table_name, constraint_name, constraint_type FROM information_schema.table_constraints ORDER BY table_name");
    constraintsTimes.push(performance.now() - start);
  }
  const avgConstraintsMs = constraintsTimes.reduce((a, b) => a + b, 0) / constraintsTimes.length;

  // Overall throughput (ops/sec) for combined queries
  const totalTimeMs = avgTablesMs + avgColumnsMs + avgConstraintsMs;
  const throughputOpsPerSec = (1000 / totalTimeMs) * iterations;

  // Check stability (variance check)
  const variance = (arr: number[]) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  };
  const tablesStable = variance(tablesTimes) < 100;
  const columnsStable = variance(columnsTimes) < 100;
  const constraintsStable = variance(constraintsTimes) < 100;

  const report: BenchReport = {
    timestamp: new Date().toISOString(),
    infoSchemaQuery: {
      tablesQueryMs: Math.round(avgTablesMs * 100) / 100,
      columnsQueryMs: Math.round(avgColumnsMs * 100) / 100,
      constraintsQueryMs: Math.round(avgConstraintsMs * 100) / 100,
      throughputOpsPerSec: Math.round(throughputOpsPerSec * 100) / 100,
    },
    stability: {
      tablesQueryStable: tablesStable,
      columnsQueryStable: columnsStable,
      constraintsQueryStable: constraintsStable,
    },
  };

  return report;
}

async function main(): Promise<void> {
  console.log("Running P4-BENCH-004 information_schema stability benchmark...");

  const report = await runInfoSchemaBench();

  console.log("\n=== P4-BENCH-004 Results ===");
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`\nQuery Performance (average ms):`);
  console.log(`  information_schema.tables: ${report.infoSchemaQuery.tablesQueryMs}ms`);
  console.log(`  information_schema.columns: ${report.infoSchemaQuery.columnsQueryMs}ms`);
  console.log(`  information_schema.table_constraints: ${report.infoSchemaQuery.constraintsQueryMs}ms`);
  console.log(`  Throughput: ${report.infoSchemaQuery.throughputOpsPerSec} ops/sec`);
  console.log(`\nStability (variance < 100ms):`);
  console.log(`  tables query stable: ${report.stability.tablesQueryStable}`);
  console.log(`  columns query stable: ${report.stability.columnsQueryStable}`);
  console.log(`  constraints query stable: ${report.stability.constraintsQueryStable}`);

  // Write report
  const { writeFileSync } = await import("node:fs");
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${REPORT_PATH}`);
}

main().catch(console.error);
