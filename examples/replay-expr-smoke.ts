import type { SqlRow } from "../src/types.js";
import { createReplayQueryExecutor } from "../src/query-replay.js";

// compile-time smoke for replay WHERE expression parser/evaluator changes
const _sampleRows: SqlRow[] = [
  { id: "r1", a: 10, b: 2, c: null },
  { id: "r2", a: 4, b: 3, c: "x" },
];

function _noop() {
  return createReplayQueryExecutor as unknown;
}

console.log("replay expression compile smoke ok", _sampleRows.length, typeof _noop);
