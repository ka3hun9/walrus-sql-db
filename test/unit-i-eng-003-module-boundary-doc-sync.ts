import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

await import("./module-split-p1-smoke.ts");

const docPath = "docs/sql-engine-module-boundary-graph.md";
const doc = readFileSync(docPath, "utf8");

const requiredSnippets = [
  "## I-ENG-003",
  "## Module Boundaries",
  "## Dependency Graph",
  "src/types",
  "src/error",
  "src/catalog",
  "src/parser",
  "src/executor",
  "src/storage",
  "```mermaid",
  "flowchart LR",
];

for (const snippet of requiredSnippets) {
  assert.ok(doc.includes(snippet), `module-boundary doc missing: ${snippet}`);
}

console.log("ok: I-ENG-003 module boundary doc + dependency graph sync");
