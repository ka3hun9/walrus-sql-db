import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const clientSrc = readFileSync("src/client.ts", "utf8");
const replaySrc = readFileSync("src/query-replay.ts", "utf8");

for (const [name, source, forbidden] of [
  ["client", clientSrc, /private\s+eq\s*\(/],
  ["client", clientSrc, /private\s+compare\s*\(/],
  ["client", clientSrc, /String\(a\)\s*===\s*String\(b\)/],
  ["client", clientSrc, /localeCompare\(/],
  ["query-replay", replaySrc, /function\s+eq\s*\(/],
  ["query-replay", replaySrc, /function\s+compare\s*\(/],
  ["query-replay", replaySrc, /String\(a\)\s*===\s*String\(b\)/],
  ["query-replay", replaySrc, /localeCompare\(/],
] as const) {
  assert.equal(forbidden.test(source), false, `${name} still contains primitive shortcut: ${forbidden}`);
}

assert.ok(clientSrc.includes("normalizeComparableTypedPair"), "client should normalize comparisons via TypedValue");
assert.ok(replaySrc.includes("normalizeComparableTypedPair"), "replay should normalize comparisons via TypedValue");
assert.ok(clientSrc.includes("typedValueComparator.eq"), "client value comparisons should use typedValueComparator");
assert.ok(replaySrc.includes("typedValueComparator.eq"), "replay value comparisons should use typedValueComparator");

console.log("ok: K-MILE-001 primitive comparison shortcuts removed from value paths");
