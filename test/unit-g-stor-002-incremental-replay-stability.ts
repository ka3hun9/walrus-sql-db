import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { replayPayloadsIncremental, type ReplayPayload } from "../src/query-replay.js";

function withCommit(payload: ReplayPayload, previousCommitHash: string): ReplayPayload {
  const base: ReplayPayload = { ...payload, previousCommitHash };
  const { currentCommitHash: _drop, ...forHash } = base;
  const currentCommitHash = createHash("sha256").update(JSON.stringify(forHash)).digest("hex");
  return { ...base, currentCommitHash };
}

const p1 = withCommit(
  {
    v: 1,
    op: "INSERT",
    table: "t",
    row: { id: 1, v: 10 },
  },
  "GENESIS",
);

const p2 = withCommit(
  {
    v: 1,
    op: "UPDATE",
    table: "t",
    set: { v: 20 },
    where: { field: "id", value: "1" },
  },
  p1.currentCommitHash!,
);

const badChain = withCommit(
  {
    v: 1,
    op: "UPDATE",
    table: "t",
    set: { v: 30 },
    where: { field: "id", value: "1" },
  },
  "BAD_PREV_HASH",
);

const p4: ReplayPayload = {
  v: 1,
  op: "INSERT",
  table: "t",
  row: { id: 2, v: 5 },
};

const p5: ReplayPayload = {
  v: 1,
  op: "DELETE",
  table: "t",
  where: { field: "id", value: "1" },
};

const allPayloads: ReplayPayload[] = [p1, p2, badChain, p4, p5];

const full = replayPayloadsIncremental([], allPayloads);
assert.deepEqual(full.rows, [{ id: 2, v: 5 }]);
assert.equal(full.invalidPayloads, 1);
assert.equal(full.lastCommitHash, p2.currentCommitHash);

const part1 = replayPayloadsIncremental([], [p1, p2]);
const part2 = replayPayloadsIncremental(part1.rows, [badChain, p4, p5], part1.lastCommitHash);
assert.deepEqual(part2.rows, full.rows);
assert.equal(part2.invalidPayloads, 1);
assert.equal(part2.lastCommitHash, full.lastCommitHash);

console.log("ok: G-STOR-002 incremental replay is stable and replayable");
