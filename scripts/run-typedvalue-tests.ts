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

function shouldRun(filePath: string): boolean {
  const base = basename(filePath);
  if (base.includes("-debug") || base.includes("-probe")) return false;
  return base.startsWith("unit-k-tval-") || base.startsWith("unit-k-mile-");
}

const testRoot = resolve("test");
const allTsFiles = await collectTsFiles(testRoot);
const selected = allTsFiles.filter((path) => shouldRun(path)).sort();

if (selected.length === 0) {
  throw new Error("No TypedValue test files selected in test/ (expected unit-k-tval-* or unit-k-mile-*).");
}

let passed = 0;
for (let i = 0; i < selected.length; i++) {
  const abs = selected[i]!;
  const rel = relative(process.cwd(), abs);
  console.log(`[typedvalue-test ${i + 1}/${selected.length}] ${rel}`);
  const modUrl = `${pathToFileURL(abs).href}?v=${Date.now()}_${i}`;
  await import(modUrl);
  passed += 1;
}

console.log(`typedvalue-tests ok: passed=${passed}/${selected.length}`);
