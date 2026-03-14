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
  { name: "phasea23-join-aware-unique-constraint", script: "examples/sql-phasea23-join-aware-unique-constraint-regression.ts" },
  { name: "phasea24-join-aware-type-constraint", script: "examples/sql-phasea24-join-aware-type-constraint-regression.ts" },
  { name: "phasea25-join-aware-not-null-constraint", script: "examples/sql-phasea25-join-aware-not-null-constraint-regression.ts" },
  { name: "phasea26-join-aware-delete-unique-cleanup", script: "examples/sql-phasea26-join-aware-delete-unique-cleanup-regression.ts" },
  { name: "phasea27-join-aware-composite-unique-constraint", script: "examples/sql-phasea27-join-aware-composite-unique-constraint-regression.ts" },
  { name: "phasea28-join-aware-delete-composite-unique-cleanup", script: "examples/sql-phasea28-join-aware-delete-composite-unique-cleanup-regression.ts" },
  { name: "phasea29-join-aware-constraint-cost-path", script: "examples/sql-phasea29-join-aware-constraint-cost-path-regression.ts" },
  { name: "phasea30-join-aware-conflict-cost-path", script: "examples/sql-phasea30-join-aware-conflict-cost-path-regression.ts" },
  { name: "phasea31-join-aware-left-target-cost-isolation", script: "examples/sql-phasea31-join-aware-left-target-cost-isolation-regression.ts" },
  { name: "phasea32-join-aware-noop-cost-stability", script: "examples/sql-phasea32-join-aware-noop-cost-stability-regression.ts" },
  { name: "phasea33-join-aware-noop-cost-isolation", script: "examples/sql-phasea33-join-aware-noop-cost-isolation-regression.ts" },
  { name: "phasea34-join-aware-dedup-target-cost", script: "examples/sql-phasea34-join-aware-dedup-target-cost-regression.ts" },
  { name: "phasea35-join-aware-conflict-state-stability", script: "examples/sql-phasea35-join-aware-conflict-state-stability-regression.ts" },
  { name: "phasea36-join-aware-delete-conflictcheck-neutral", script: "examples/sql-phasea36-join-aware-delete-conflictcheck-neutral-regression.ts" },
  { name: "phasea37-join-aware-conflict-cost-isolation", script: "examples/sql-phasea37-join-aware-conflict-cost-isolation-regression.ts" },
  { name: "phasea38-join-aware-delete-cost-isolation", script: "examples/sql-phasea38-join-aware-delete-cost-isolation-regression.ts" },
  { name: "phasea39-join-aware-unsupported-join-type-cost-stability", script: "examples/sql-phasea39-join-aware-unsupported-join-type-cost-stability-regression.ts" },
  { name: "phasea40-join-aware-right-join-cost-stability", script: "examples/sql-phasea40-join-aware-right-join-cost-stability-regression.ts" },
  { name: "phasea41-join-aware-full-join-cost-stability", script: "examples/sql-phasea41-join-aware-full-join-cost-stability-regression.ts" },
  { name: "phasea42-join-aware-full-outer-join-cost-stability", script: "examples/sql-phasea42-join-aware-full-outer-join-cost-stability-regression.ts" },
  { name: "phasea43-join-aware-left-outer-join-cost-stability", script: "examples/sql-phasea43-join-aware-left-outer-join-cost-stability-regression.ts" },
  { name: "phasea44-join-aware-right-outer-join-cost-stability", script: "examples/sql-phasea44-join-aware-right-outer-join-cost-stability-regression.ts" },
  { name: "phasea45-join-aware-cross-join-cost-stability", script: "examples/sql-phasea45-join-aware-cross-join-cost-stability-regression.ts" },
  { name: "phasea46-unsupported-alt-dml-shape-cost-stability", script: "examples/sql-phasea46-unsupported-alt-dml-shape-cost-stability-regression.ts" },
  { name: "phasea47-inner-join-cost-path", script: "examples/sql-phasea47-inner-join-cost-path-regression.ts" },
  { name: "phasea48-implicit-join-hot-path-cost", script: "examples/sql-phasea48-implicit-join-hot-path-cost-regression.ts" },
  { name: "phasea49-natural-join-cost-stability", script: "examples/sql-phasea49-natural-join-cost-stability-regression.ts" },
  { name: "phasea50-inner-join-on-side-symmetry-cost", script: "examples/sql-phasea50-inner-join-on-side-symmetry-cost-regression.ts" },
  { name: "phasea51-unqualified-on-field-rejection-cost-stability", script: "examples/sql-phasea51-unqualified-on-field-rejection-cost-stability-regression.ts" },
  { name: "phasea52-unqualified-same-name-on-hot-path-cost", script: "examples/sql-phasea52-unqualified-same-name-on-hot-path-cost-regression.ts" },
  { name: "phasea53-invalid-on-field-shape-rejection-cost-stability", script: "examples/sql-phasea53-invalid-on-field-shape-rejection-cost-stability-regression.ts" },
  { name: "phasea54-on-prefix-cross-side-rejection-cost-stability", script: "examples/sql-phasea54-on-prefix-cross-side-rejection-cost-stability-regression.ts" },
  { name: "phasea55-on-literal-shape-rejection-cost-stability", script: "examples/sql-phasea55-on-literal-shape-rejection-cost-stability-regression.ts" },
  { name: "phasea56-on-expression-shape-rejection-cost-stability", script: "examples/sql-phasea56-on-expression-shape-rejection-cost-stability-regression.ts" },
  { name: "phasea57-join-alias-conflict-rejection-cost-stability", script: "examples/sql-phasea57-join-alias-conflict-rejection-cost-stability-regression.ts" },
  { name: "phasea58-right-alias-left-table-conflict-rejection-cost-stability", script: "examples/sql-phasea58-right-alias-left-table-conflict-rejection-cost-stability-regression.ts" },
  { name: "phasea59-left-alias-right-table-conflict-rejection-cost-stability", script: "examples/sql-phasea59-left-alias-right-table-conflict-rejection-cost-stability-regression.ts" },
  { name: "phasea60-target-alias-left-name-conflict-rejection-cost-stability", script: "examples/sql-phasea60-target-alias-left-name-conflict-rejection-cost-stability-regression.ts" },
  { name: "phasea61-nonleft-target-alias-rejection-cost-stability", script: "examples/sql-phasea61-nonleft-target-alias-rejection-cost-stability-regression.ts" },
  { name: "phasea62-left-table-name-target-when-aliased-rejection-cost-stability", script: "examples/sql-phasea62-left-table-name-target-when-aliased-rejection-cost-stability-regression.ts" },
  { name: "phasea63-nonleft-target-table-rejection-cost-stability", script: "examples/sql-phasea63-nonleft-target-table-rejection-cost-stability-regression.ts" },
  { name: "phasea64-mixed-target-and-multidelete-rejection-cost-stability", script: "examples/sql-phasea64-mixed-target-and-multidelete-rejection-cost-stability-regression.ts" },
  { name: "phasea65-mixed-table-target-boundary-cost-stability", script: "examples/sql-phasea65-mixed-table-target-boundary-cost-stability-regression.ts" },
  { name: "phasea66-mixed-table-target-noalias-boundary-cost-stability", script: "examples/sql-phasea66-mixed-table-target-noalias-boundary-cost-stability-regression.ts" },
  { name: "phasea67-rightfirst-mixed-set-rejection-cost-stability", script: "examples/sql-phasea67-rightfirst-mixed-set-rejection-cost-stability-regression.ts" },
  { name: "phasea68-rightfirst-mixed-table-set-rejection-cost-stability", script: "examples/sql-phasea68-rightfirst-mixed-table-set-rejection-cost-stability-regression.ts" },
  { name: "phasea69-right-table-name-with-right-alias-rejection-cost-stability", script: "examples/sql-phasea69-right-table-name-with-right-alias-rejection-cost-stability-regression.ts" },
  { name: "phasea70-right-alias-plus-left-tablename-mix-rejection-cost-stability", script: "examples/sql-phasea70-right-alias-plus-left-tablename-mix-rejection-cost-stability-regression.ts" },
  { name: "phasea71-leftfirst-right-tablename-with-right-alias-boundary-cost-stability", script: "examples/sql-phasea71-leftfirst-right-tablename-with-right-alias-boundary-cost-stability-regression.ts" },
  { name: "phasea72-left-tablename-plus-right-alias-mix-boundary-cost-stability", script: "examples/sql-phasea72-left-tablename-plus-right-alias-mix-boundary-cost-stability-regression.ts" },
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
