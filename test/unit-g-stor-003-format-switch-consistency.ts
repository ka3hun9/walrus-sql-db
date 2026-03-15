import { strict as assert } from "node:assert";
import {
  deserializeReplayCache,
  serializeReplayCache,
  transcodeReplayCache,
  type PersistedReplayCache,
} from "../src/query-replay.js";

const sample: PersistedReplayCache = {
  "0x-table-switch": {
    cursor: { txDigest: "0x1", eventSeq: "5" },
    rows: [
      { id: 1, name: "A", amount: "123.4500", ok: true, nullable: null },
      { id: 2, name: "B", amount: "9999999999999999", ok: false, nullable: null },
    ],
    seenDigests: ["0xaaa", "0xbbb"],
    initialized: true,
    lastCommitHash: "0xhash",
    invalidPayloads: 0,
  },
};

const jsonBlob = serializeReplayCache(sample, "json");
const msgpackBlob = transcodeReplayCache(jsonBlob, "json", "msgpack");
const cborBlob = transcodeReplayCache(msgpackBlob, "msgpack", "cbor");
const jsonBlob2 = transcodeReplayCache(cborBlob, "cbor", "json");

assert.deepEqual(deserializeReplayCache(jsonBlob, "json"), sample);
assert.deepEqual(deserializeReplayCache(msgpackBlob, "msgpack"), sample);
assert.deepEqual(deserializeReplayCache(cborBlob, "cbor"), sample);
assert.deepEqual(deserializeReplayCache(jsonBlob2, "json"), sample);

console.log("ok: G-STOR-003 MessagePack/CBOR format switching is consistent");
