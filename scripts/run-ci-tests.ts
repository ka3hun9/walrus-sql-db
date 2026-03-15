import { promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

type CiScope = "all" | "unit" | "integration" | "regression";

function resolveScope(raw?: string): CiScope {
  const normalized = (raw ?? "all").toLowerCase();
  if (normalized === "all" || normalized === "unit" || normalized === "integration" || normalized === "regression") {
    return normalized;
  }
  throw new Error(`Unsupported CI scope: ${raw ?? "(empty)"}. Expected one of: all|unit|integration|regression`);
}

function isBenchmarkGate(base: string): boolean {
  return base === "unit-h-test-006-performance-benchmark-gate.ts";
}

function shouldRun(filePath: string, scope: CiScope): boolean {
  const base = basename(filePath);
  const skip = base.includes("-debug") || base.includes("-probe");
  if (skip) return false;

  if (scope === "unit") return base.startsWith("unit-") && !isBenchmarkGate(base);
  if (scope === "integration") return base.startsWith("integration-");
  if (scope === "regression") return base.endsWith("-smoke.ts");

  const unit = base.startsWith("unit-") && !isBenchmarkGate(base);
  const integration = base.startsWith("integration-");
  const regression = base.endsWith("-smoke.ts");
  return unit || integration || regression;
}

const scope = resolveScope(process.argv[2]);
const testRoot = resolve("test");
const allTsFiles = await collectTsFiles(testRoot);
const selected = allTsFiles.filter((path) => shouldRun(path, scope)).sort();

if (selected.length === 0) {
  throw new Error(`No CI test files selected in test/ for scope=${scope}`);
}

let passed = 0;
for (let i = 0; i < selected.length; i++) {
  const abs = selected[i]!;
  const rel = relative(process.cwd(), abs);
  console.log(`[ci-test ${i + 1}/${selected.length}] ${rel}`);
  const modUrl = `${pathToFileURL(abs).href}?v=${Date.now()}_${i}`;
  await import(modUrl);
  passed += 1;
}

console.log(`ci-tests ok: scope=${scope}, passed=${passed}/${selected.length}`);
