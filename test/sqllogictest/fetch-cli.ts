/**
 * CLI tool to download SQLite sqllogictest fixture files.
 * Run: npx tsx test/sqllogictest/fetch-cli.ts
 */

import { downloadAllPriorityTests, cachedTestCount, loadCachedTest } from "./fetch.js";

async function main() {
  const before = cachedTestCount();
  console.log(`Cached test files before: ${before}`);

  const downloaded = await downloadAllPriorityTests();
  console.log(`\nTotal cached after: ${cachedTestCount()}`);

  if (downloaded === 0 && before > 0) {
    console.log("All test files already cached.");
  } else {
    console.log(`Downloaded ${downloaded} new files.`);
  }
}

main().catch(console.error);
