import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runSqlLogicFile } from "./sql-logic-runner.js";

type SuiteEntry = {
  id: string;
  file: string;
  focus?: string[];
  note?: string;
};

type SuiteManifest = {
  suiteId: string;
  description?: string;
  reportPath?: string;
  entries: SuiteEntry[];
};

type EntryResult = {
  id: string;
  file: string;
  focus: string[];
  note: string | null;
  total: number;
  passed: number;
  durationMs: number;
  status: "passed" | "failed";
  error: string | null;
};

function loadManifest(path: string): SuiteManifest {
  const full = resolve(path);
  const raw = readFileSync(full, "utf8");
  const parsed = JSON.parse(raw) as Partial<SuiteManifest>;

  if (!parsed.suiteId || typeof parsed.suiteId !== "string") {
    throw new Error(`Invalid suite manifest (${path}): suiteId is required`);
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw new Error(`Invalid suite manifest (${path}): entries must be a non-empty array`);
  }

  for (const [idx, entry] of parsed.entries.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid suite manifest (${path}): entries[${idx}] must be an object`);
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error(`Invalid suite manifest (${path}): entries[${idx}].id is required`);
    }
    if (typeof entry.file !== "string" || !entry.file.trim()) {
      throw new Error(`Invalid suite manifest (${path}): entries[${idx}].file is required`);
    }
  }

  return parsed as SuiteManifest;
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2] ?? "test/sqllogic/suites/p4-boot-001-minimal.json";
  const manifest = loadManifest(manifestPath);
  const reportPath = process.argv[3] ?? manifest.reportPath ?? "reports/sql-logic-suite-report.json";
  const reportFullPath = resolve(reportPath);

  const results: EntryResult[] = [];
  let failedEntries = 0;

  for (const entry of manifest.entries) {
    const startedAt = Date.now();
    try {
      const out = await runSqlLogicFile(entry.file);
      const durationMs = Date.now() - startedAt;
      const result: EntryResult = {
        id: entry.id,
        file: entry.file,
        focus: entry.focus ?? [],
        note: entry.note ?? null,
        total: out.total,
        passed: out.passed,
        durationMs,
        status: "passed",
        error: null,
      };
      results.push(result);
      console.log(`PASS :: ${entry.id} -> ${out.passed}/${out.total} (${durationMs}ms)`);
    } catch (err) {
      failedEntries += 1;
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const result: EntryResult = {
        id: entry.id,
        file: entry.file,
        focus: entry.focus ?? [],
        note: entry.note ?? null,
        total: 0,
        passed: 0,
        durationMs,
        status: "failed",
        error: message,
      };
      results.push(result);
      console.log(`FAIL :: ${entry.id} -> ${message}`);
    }
  }

  const totalCases = results.reduce((acc, item) => acc + item.total, 0);
  const passedCases = results.reduce((acc, item) => acc + item.passed, 0);
  const failedCases = totalCases - passedCases;

  const summary = {
    suiteId: manifest.suiteId,
    description: manifest.description ?? "",
    generatedAt: new Date().toISOString(),
    entryCount: results.length,
    passedEntries: results.length - failedEntries,
    failedEntries,
    totalCases,
    passedCases,
    failedCases,
  };

  mkdirSync(dirname(reportFullPath), { recursive: true });
  writeFileSync(
    reportFullPath,
    JSON.stringify(
      {
        summary,
        manifestPath: resolve(manifestPath),
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Report written: ${reportFullPath}`);

  if (failedEntries > 0 || failedCases > 0) {
    throw new Error(
      `SQL logic suite failed: failedEntries=${failedEntries}, failedCases=${failedCases}, totalCases=${totalCases}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
