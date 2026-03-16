import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  deserializeReplayCache,
  replayPayloadsIncremental,
  serializeReplayCache,
  transcodeReplayCache,
  type PersistedReplayCache,
  type ReplayCacheFormat,
  type ReplayPayload,
} from "../src/query-replay.js";
import { WalrusSqlClient } from "../src/client.js";

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
    table: "typed_stor",
    row: { id: 1, v: 10, ok: true, note: "alpha", nullable: null },
  },
  "GENESIS",
);
const p2 = withCommit(
  {
    v: 1,
    op: "UPDATE",
    table: "typed_stor",
    set: { v: 20 },
    where: { field: "id", value: "1" },
  },
  p1.currentCommitHash!,
);
const p3 = withCommit(
  {
    v: 1,
    op: "INSERT",
    table: "typed_stor",
    row: { id: 2, v: 5, ok: false, note: "beta", nullable: null },
  },
  p2.currentCommitHash!,
);
const p4 = withCommit(
  {
    v: 1,
    op: "DELETE",
    table: "typed_stor",
    where: { field: "id", value: "1" },
  },
  p3.currentCommitHash!,
);

const replayed = replayPayloadsIncremental([], [p1, p2, p3, p4]);
assert.deepEqual(replayed.rows, [{ id: 2, v: 5, ok: false, note: "beta", nullable: null }]);
assert.equal(replayed.invalidPayloads, 0);

const cache: PersistedReplayCache = {
  "0xk25": {
    cursor: { txDigest: "0xabc", eventSeq: "9" },
    rows: replayed.rows,
    seenDigests: ["0x1", "0x2"],
    initialized: true,
    lastCommitHash: replayed.lastCommitHash,
    invalidPayloads: replayed.invalidPayloads,
  },
};

for (const format of ["json", "msgpack", "cbor"] as ReplayCacheFormat[]) {
  const blob = serializeReplayCache(cache, format);
  const decoded = deserializeReplayCache(blob, format);
  assert.deepEqual(decoded, cache);
}

const json = serializeReplayCache(cache, "json");
const msgpack = transcodeReplayCache(json, "json", "msgpack");
const cbor = transcodeReplayCache(msgpack, "msgpack", "cbor");
const jsonRoundtrip = transcodeReplayCache(cbor, "cbor", "json");
assert.deepEqual(deserializeReplayCache(jsonRoundtrip, "json"), cache);

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: true, ttlMs: 30_000, maxEntries: 128 },
});

await db.execute("CREATE TABLE t_k25 (id INT PRIMARY KEY, v INT)");
for (let i = 1; i <= 20; i++) {
  await db.execute(`INSERT INTO t_k25 (id, v) VALUES (${i}, ${i})`);
}
await db.query("SELECT id, v FROM t_k25 ORDER BY id");

for (let i = 1; i <= 40; i++) {
  const id = (i % 20) + 1;
  const next = 100 + i;
  await db.execute(`UPDATE t_k25 SET v = ${next} WHERE id = ${id}`);
  const q = await db.query(`SELECT v FROM t_k25 WHERE id = ${id}`);
  assert.equal(q.rows[0]?.v, next);
}

console.log("ok: K-TVAL-025 storage typed serialization/replay/cache consistency regression");
