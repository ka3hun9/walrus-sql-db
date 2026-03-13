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
