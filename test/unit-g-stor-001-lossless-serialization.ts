import { strict as assert } from "node:assert";
import { deserializeReplayCache, serializeReplayCache, type PersistedReplayCache, type ReplayCacheFormat } from "../src/query-replay.js";
import { encodeBlob } from "../src/types.js";

const sample: PersistedReplayCache = {
  "0x-table-1": {
    cursor: { txDigest: "0xabc", eventSeq: "7" },
    rows: [
      {
        id: 42,
        ratio: 0.125,
        big_id: "9223372036854775807",
        amount: "1234567890.123400",
        payload: encodeBlob("hello"),
        ok: true,
        note: "alpha",
        nullable: null,
      },
    ],
    seenDigests: ["0xaaa", "0xbbb"],
    initialized: true,
    lastCommitHash: "0xhash",
    invalidPayloads: 0,
  },
};

for (const format of ["json", "msgpack", "cbor"] as ReplayCacheFormat[]) {
  const blob = serializeReplayCache(sample, format);
  const roundtrip = deserializeReplayCache(blob, format);
  assert.deepEqual(roundtrip, sample);
}

// Backward compatibility: legacy plain-JSON payloads should still decode.
const legacyJson = new TextEncoder().encode(JSON.stringify(sample));
const legacyDecoded = deserializeReplayCache(legacyJson, "json");
assert.deepEqual(legacyDecoded, sample);

console.log("ok: G-STOR-001 replay-cache serialization/deserialization is lossless");
