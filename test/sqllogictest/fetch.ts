/**
 * SQLite test file acquisition utility
 *
 * Downloads and caches sqllogictest format .test files from the dolthub/sqllogictest
 * mirror of the official SQLite SQL Logic Test suite.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** dolthub/sqllogictest branch */
export const SQLITE_COMMIT = "master";

/** Base URL for sqllogictest files in the dolthub mirror */
export const SQLITE_TEST_BASE = `https://raw.githubusercontent.com/dolthub/sqllogictest/${SQLITE_COMMIT}/test`;

/** Local cache directory */
export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Ensure cache directory exists */
export function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Hash a URL for use as a cache key */
export function cacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** Path to cached file */
export function cachePath(url: string): string {
  ensureCacheDir();
  return join(CACHE_DIR, `${cacheKey(url)}.test`);
}

/** Check if a file is in cache */
export function isCached(url: string): boolean {
  return existsSync(cachePath(url));
}

/** Fetch a test file from SQLite source (or load from cache) */
export async function fetchTestFile(testName: string): Promise<string> {
  const url = `${SQLITE_TEST_BASE}/${testName}`;
  const localPath = cachePath(url);

  if (isCached(url)) {
    return readFileSync(localPath, "utf-8");
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const content = await response.text();
    writeFileSync(localPath, content, "utf-8");
    return content;
  } catch (err) {
    // If offline, try to load from cache anyway
    if (existsSync(localPath)) {
      return readFileSync(localPath, "utf-8");
    }
    throw err;
  }
}

/** Fetch multiple test files in parallel */
export async function fetchTestFiles(testNames: string[]): Promise<Map<string, string>> {
  const results = await Promise.allSettled(testNames.map(async (name) => {
    const content = await fetchTestFile(name);
    return { name, content };
  }));

  const map = new Map<string, string>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled") {
      map.set(testNames[i]!, r.value.content);
    } else {
      console.warn(`Failed to fetch ${testNames[i]}: ${r.reason}`);
    }
  }
  return map;
}

/**
 * Priority list of SQLite test files (only files that exist at version-3.45.0)
 * 39 test files covering: SELECT, WHERE, LIMIT, ORDERBY, JOIN, DISTINCT,
 * AGG (error), SUBQUERY, VIEW, INDEX, WINDOW, TRIGGER
 */
export const PRIORITY_TESTS = [
  // Basic SELECT
  "select1.test",
  "select2.test",
  "select3.test",
  "select4.test",
  "select5.test",
  // WHERE
  "where.test",
  // LIMIT
  "limit.test",
  // ORDER BY
  "orderby1.test",
  // JOIN
  "join.test",
  "join2.test",
  "join3.test",
  "join4.test",
  "join5.test",
  // Aggregate errors
  "aggerror.test",
  // DISTINCT
  "distinct.test",
  "distinctagg.test",
  // Subquery
  "subquery.test",
  // VIEW
  "view.test",
  // INDEX
  "index.test",
  "index2.test",
  "index3.test",
  "index4.test",
  "index5.test",
  "index6.test",
  "index7.test",
  // Window functions
  "window1.test",
  "window2.test",
  "window3.test",
  "window4.test",
  "window5.test",
  // TRIGGER
  "trigger1.test",
  "trigger2.test",
  "trigger3.test",
  "trigger4.test",
  "trigger5.test",
  "trigger6.test",
  "trigger7.test",
  "trigger8.test",
  "trigger9.test",
];

/**
 * NOTE: The following files return 404 at version-3.45.0 (not yet available at this tag):
 * orderby.test, agg.test, aggfunc.test, select.test, index1.test,
 * cte.test, cte0.test, cte1.test, window.test, trigger10.test
 */

/** Download all priority test files to cache */
export async function downloadAllPriorityTests(): Promise<number> {
  const map = await fetchTestFiles(PRIORITY_TESTS);
  console.log(`Downloaded ${map.size}/${PRIORITY_TESTS.length} test files to ${CACHE_DIR}`);
  return map.size;
}

/** Check which priority tests are already cached */
export function cachedTestCount(): number {
  return PRIORITY_TESTS.filter((t) => isCached(`${SQLITE_TEST_BASE}/${t}`)).length;
}

/** Load a test from cache (throws if not cached) */
export function loadCachedTest(testName: string): string {
  const url = `${SQLITE_TEST_BASE}/${testName}`;
  const path = cachePath(url);
  if (!existsSync(path)) {
    throw new Error(`Test file ${testName} is not in cache. Run downloadAllPriorityTests() first.`);
  }
  return readFileSync(path, "utf-8");
}
