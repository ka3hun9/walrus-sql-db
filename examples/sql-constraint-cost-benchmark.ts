import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

type ConstraintCost = {
  insertOps: number;
  updateOps: number;
  deleteOps: number;
  rebuildOps: number;
  conflictChecks: number;
  rowsIndexed: number;
};

type BenchReport = {
  summary: {
    profile: string;
    generatedAt: string;
  };
  scenarios: Array<{
    name: string;
    table: string;
    cost: ConstraintCost;
  }>;
};

async function scenarioIncrementalDml(): Promise<{ name: string; table: string; cost: ConstraintCost }> {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  const table = "bench_dml";

  await db.execute(
    "CREATE TABLE bench_dml (tenant INT, id INT, code VARCHAR(16) UNIQUE, val INT, PRIMARY KEY (tenant, id), UNIQUE (tenant, val))",
  );
  db.resetConstraintIndexCost(table);

  for (let i = 1; i <= 30; i++) {
    await db.execute(`INSERT INTO bench_dml (tenant, id, code, val) VALUES (1, ${i}, 'C${i}', ${100 + i})`);
  }
  for (let i = 1; i <= 10; i++) {
    await db.execute(`UPDATE bench_dml SET code = 'U${i}' WHERE tenant = 1 AND id = ${i}`);
  }
  for (let i = 21; i <= 25; i++) {
    await db.execute(`DELETE FROM bench_dml WHERE tenant = 1 AND id = ${i}`);
  }

  const cost = db.getConstraintIndexCost(table) as ConstraintCost;
  return { name: "incremental-dml", table, cost };
}

async function scenarioStructuralAlter(): Promise<{ name: string; table: string; cost: ConstraintCost }> {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  const table = "bench_alter";

  await db.execute(
    "CREATE TABLE bench_alter (tenant INT, id INT, code VARCHAR(16) UNIQUE, val INT, PRIMARY KEY (tenant, id), UNIQUE (tenant, val))",
  );

  for (let i = 1; i <= 20; i++) {
    await db.execute(`INSERT INTO bench_alter (tenant, id, code, val) VALUES (1, ${i}, 'A${i}', ${200 + i})`);
  }

  db.resetConstraintIndexCost(table);
  await db.execute("ALTER TABLE bench_alter ADD COLUMN note VARCHAR(16)");

  const cost = db.getConstraintIndexCost(table) as ConstraintCost;
  return { name: "structural-alter", table, cost };
}

async function main() {
  const reportPath = process.argv[2] ?? "reports/sql-constraint-cost.json";
  const profile = process.argv[3] ?? "pr";

  const scenarios = [await scenarioIncrementalDml(), await scenarioStructuralAlter()];

  const report: BenchReport = {
    summary: {
      profile,
      generatedAt: new Date().toISOString(),
    },
    scenarios,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[sql-constraint-cost-benchmark] wrote ${reportPath}`);
  for (const s of scenarios) {
    console.log(
      `  - ${s.name}: insert=${s.cost.insertOps}, update=${s.cost.updateOps}, delete=${s.cost.deleteOps}, rebuild=${s.cost.rebuildOps}, checks=${s.cost.conflictChecks}, rowsIndexed=${s.cost.rowsIndexed}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
