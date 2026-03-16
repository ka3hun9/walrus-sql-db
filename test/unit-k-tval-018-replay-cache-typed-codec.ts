import { strict as assert } from "node:assert";
import { deserializeReplayCache, serializeReplayCache, type PersistedReplayCache } from "../src/query-replay.js";

const cache: PersistedReplayCache = {
  t: {
    cursor: null,
    rows: [{ id: 1, name: "alice", score: 7 }],
    seenDigests: ["0x1"],
    initialized: true,
    lastCommitHash: "GENESIS",
    invalidPayloads: 0,
  },
};

const encoded = serializeReplayCache(cache, "json");
const parsed = JSON.parse(Buffer.from(encoded).toString("utf8")) as {
  version: number;
  encoding: string;
  entries: Record<string, { rows: Array<Record<string, unknown>> }>;
};
assert.equal(parsed.version, 2);
assert.equal(parsed.encoding, "typed-value-v1");

const firstCell = parsed.entries.t!.rows[0]!.id as { version?: number; type?: string; value?: unknown };
assert.equal(firstCell.version, 1);
assert.equal(firstCell.type, "INT");
assert.equal(firstCell.value, 1);

const decoded = deserializeReplayCache(encoded, "json");
assert.deepEqual(decoded, cache);

const legacyBlob = Buffer.from(
  JSON.stringify({
    version: 1,
    encoding: "sql-primitive-v1",
    entries: {
      legacy: {
        cursor: null,
        rows: [{ id: { kind: "number", value: "1" }, name: { kind: "string", value: "bob" } }],
        seenDigests: [],
        initialized: true,
        lastCommitHash: "GENESIS",
        invalidPayloads: 0,
      },
    },
  }),
);
const legacyDecoded = deserializeReplayCache(legacyBlob, "json");
assert.deepEqual(legacyDecoded.legacy?.rows, [{ id: 1, name: "bob" }]);

console.log("ok: K-TVAL-018 replay/cache typed key+value codec");
