import { readFileSync } from "node:fs";

type ConstraintCost = {
  insertOps: number;
  updateOps: number;
  deleteOps: number;
  rebuildOps: number;
  conflictChecks: number;
  rowsIndexed: number;
};

type BenchReport = {
  summary: { profile: string };
  scenarios: Array<{ name: string; table: string; cost: ConstraintCost }>;
};

type GatePolicy = {
  maxDmlRebuildOps: number;
  minAlterRebuildOps: number;
};

const policyByProfile: Record<string, GatePolicy> = {
  pr: {
    maxDmlRebuildOps: 0,
    minAlterRebuildOps: 1,
  },
  nightly: {
    maxDmlRebuildOps: 0,
    minAlterRebuildOps: 1,
  },
};

function main() {
  const reportPath = process.argv[2] ?? "reports/sql-constraint-cost.json";
  const profile = (process.argv[3] ?? "pr").toLowerCase();

  const policy = policyByProfile[profile] ?? policyByProfile.pr;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as BenchReport;

  const dml = report.scenarios.find((s) => s.name === "incremental-dml");
  const alter = report.scenarios.find((s) => s.name === "structural-alter");

  if (!dml || !alter) {
    throw new Error("[sql-constraint-cost-gate] missing required scenarios: incremental-dml / structural-alter");
  }

  const okDml = dml.cost.rebuildOps <= policy.maxDmlRebuildOps;
  const okAlter = alter.cost.rebuildOps >= policy.minAlterRebuildOps;

  console.log(
    `[sql-constraint-cost-gate] profile=${profile} dml.rebuild=${dml.cost.rebuildOps} alter.rebuild=${alter.cost.rebuildOps}`,
  );

  if (!okDml || !okAlter) {
    throw new Error(
      `[sql-constraint-cost-gate] FAILED policy: maxDmlRebuildOps=${policy.maxDmlRebuildOps}, minAlterRebuildOps=${policy.minAlterRebuildOps}`,
    );
  }

  console.log("[sql-constraint-cost-gate] OK");
}

main();
