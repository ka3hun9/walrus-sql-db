import { spawn } from "node:child_process";

type RunnerCase = {
  name: string;
  script: string;
};

const cases: RunnerCase[] = [
  { name: "g3a-semantics", script: "examples/sql-semantics-g3a.ts" },
  { name: "g3a-client-strict-where", script: "examples/sql-client-g3a-strict-where.ts" },
  { name: "g3a-ast-tree-consistency", script: "examples/sql-client-g3a-ast-tree-consistency.ts" },
  { name: "g3b-subquery-edge", script: "examples/sql-g3b-subquery-edge-regression.ts" },
  { name: "g3b-expr-edge", script: "examples/sql-g3b-expr-edge-regression.ts" },
  { name: "g3b-cast-case", script: "examples/sql-g3b-cast-case-regression.ts" },
  { name: "g3b-composed-expr", script: "examples/sql-g3b-composed-expr-regression.ts" },
  { name: "g3c-window-row-number", script: "examples/sql-g3c-window-row-number.ts" },
  { name: "g3c-window-edge", script: "examples/sql-g3c-window-edge-regression.ts" },
  { name: "g3c-setop", script: "examples/sql-g3c-setop-regression.ts" },
  { name: "g3d-setop-window-combo", script: "examples/sql-g3d-setop-window-combo.ts" },
  { name: "g3d-setop-projection-order", script: "examples/sql-g3d-setop-projection-order-regression.ts" },
  { name: "g3d-setop-order-limit-offset", script: "examples/sql-g3d-setop-order-limit-offset-regression.ts" },
  { name: "g3d-setop-error", script: "examples/sql-g3d-setop-error-regression.ts" },
  { name: "g3d-in-literal-ast", script: "examples/sql-g3d-in-literal-ast-regression.ts" },
  { name: "g5-dialect-gating", script: "examples/sql-g5-dialect-gating-regression.ts" },
  { name: "g5-sqlserver-top", script: "examples/sql-g5-sqlserver-top-regression.ts" },
  { name: "g5-fetch", script: "examples/sql-g5-fetch-regression.ts" },
  { name: "g5-quoting", script: "examples/sql-g5-quoting-regression.ts" },
  { name: "g5-function-gating", script: "examples/sql-g5-function-gating-regression.ts" },
  { name: "g5-operator-gating", script: "examples/sql-g5-operator-gating-regression.ts" },
  { name: "g5-cast-type-gating", script: "examples/sql-g5-cast-type-gating-regression.ts" },
  { name: "g5-clause-shape", script: "examples/sql-g5-clause-shape-regression.ts" },
  { name: "g5-union-tail-dialect", script: "examples/sql-g5-union-tail-dialect-regression.ts" },
  { name: "phasea1-type-ddl-constraint", script: "examples/sql-phasea1-type-ddl-constraint-regression.ts" },
  { name: "phasea2-dml-ddl-shape", script: "examples/sql-phasea2-dml-ddl-shape-regression.ts" },
  { name: "phasea3-dml-subquery", script: "examples/sql-phasea3-dml-subquery-regression.ts" },
  { name: "phasea4-dml-any-all", script: "examples/sql-phasea4-dml-any-all-regression.ts" },
  { name: "phasea5-ddl-index", script: "examples/sql-phasea5-ddl-index-regression.ts" },
  { name: "phasea6-composite-key", script: "examples/sql-phasea6-composite-key-regression.ts" },
  { name: "phasea7-index-incremental", script: "examples/sql-phasea7-index-incremental-regression.ts" },
  { name: "phasea8-constraint-cost", script: "examples/sql-phasea8-constraint-cost-regression.ts" },
  { name: "phasea10-join-aware-dml-planning", script: "examples/sql-phasea10-join-aware-dml-planning-regression.ts" },
  { name: "phasea11-join-aware-dml-exec", script: "examples/sql-phasea11-join-aware-dml-exec-regression.ts" },
  { name: "phasea12-join-aware-delete-exec", script: "examples/sql-phasea12-join-aware-delete-exec-regression.ts" },
  { name: "phasea13-join-aware-alias-qualified", script: "examples/sql-phasea13-join-aware-alias-qualified-regression.ts" },
  { name: "phasea16-join-aware-mixed-prefix", script: "examples/sql-phasea16-join-aware-mixed-prefix-regression.ts" },
  { name: "phasea18-join-aware-ambiguous-where", script: "examples/sql-phasea18-join-aware-ambiguous-where-regression.ts" },
  { name: "phasea19-join-aware-on-field-validation", script: "examples/sql-phasea19-join-aware-on-field-validation-regression.ts" },
  { name: "phasea20-join-aware-alias-safety", script: "examples/sql-phasea20-join-aware-alias-safety-regression.ts" },
  { name: "phasea21-join-aware-self-join-boundary", script: "examples/sql-phasea21-join-aware-self-join-boundary-regression.ts" },
  { name: "phasea22-join-aware-as-alias", script: "examples/sql-phasea22-join-aware-as-alias-regression.ts" },
];

function runCase(c: RunnerCase): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", c.script], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`case ${c.name} failed with code ${code ?? -1}`));
    });
  });
}

async function main() {
  const startedAt = Date.now();
  for (const c of cases) {
    // eslint-disable-next-line no-console
    console.log(`\n==> [${c.name}] ${c.script}`);
    await runCase(c);
  }
  const ms = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(`\nSQL semantic grouped runner OK (${cases.length} cases, ${ms} ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
