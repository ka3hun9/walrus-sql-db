import { readFileSync } from "node:fs";

type CategorySummary = {
  category: string;
  total: number;
  passed: number;
  failed: number;
  xfail: number;
  xpass: number;
};

type CompareReport = {
  summary: {
    profile: "pr" | "nightly" | string;
    total: number;
    passed: number;
    failed: number;
  };
  categorySummary: CategorySummary[];
};

type BudgetPolicy = {
  pr: {
    maxMismatchRatio: number;
    maxFailed: number;
    maxXpass: number;
  };
  nightly: {
    maxMismatchRatio: number;
    maxFailed: number;
    maxXpass: number;
  };
};

const defaultPolicy: BudgetPolicy = {
  pr: {
    maxMismatchRatio: 0,
    maxFailed: 0,
    maxXpass: 0,
  },
  nightly: {
    maxMismatchRatio: 0.02,
    maxFailed: Number.MAX_SAFE_INTEGER,
    maxXpass: 0,
  },
};

function main() {
  const reportPath = process.argv[2] ?? "reports/sql-compare-category.json";
  const profile = ((process.argv[3] ?? "pr").toLowerCase() as "pr" | "nightly");

  const report = JSON.parse(readFileSync(reportPath, "utf8")) as CompareReport;
  const policy = defaultPolicy[profile];
  const total = report.summary.total || 0;
  const failed = report.summary.failed || 0;
  const xpass = report.categorySummary.reduce((acc, c) => acc + (c.xpass ?? 0), 0);
  const mismatchRatio = total > 0 ? failed / total : 0;

  const okFailed = failed <= policy.maxFailed;
  const okXpass = xpass <= policy.maxXpass;
  const okRatio = mismatchRatio <= policy.maxMismatchRatio;

  // eslint-disable-next-line no-console
  console.log(
    `[sql-budget-gate] profile=${profile} total=${total} failed=${failed} mismatchRatio=${mismatchRatio.toFixed(4)} xpass=${xpass}`,
  );

  if (!okFailed || !okXpass || !okRatio) {
    throw new Error(
      `[sql-budget-gate] FAILED policy: maxFailed=${policy.maxFailed}, maxMismatchRatio=${policy.maxMismatchRatio}, maxXpass=${policy.maxXpass}`,
    );
  }

  // eslint-disable-next-line no-console
  console.log("[sql-budget-gate] OK");
}

main();
