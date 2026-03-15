import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

let transientAttempts = 0;
const transientDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    transientAttempts += 1;
    if (transientAttempts < 3) throw new Error("temporary network timeout");
    return { digest: "ok-digest", raw: { ok: true } };
  },
});

const ok = await transientDb.execute("INSERT INTO t_retry_wal (id) VALUES (1)");
assert.equal(ok.txDigest, "ok-digest");
assert.equal(transientAttempts, 3);
assert.deepEqual(
  transientDb.getStorageWriteLog("t_retry_wal").map((w) => [w.op, w.mode]),
  [["INSERT_ROW", "onchain"]],
);

let failAttempts = 0;
const failDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    failAttempts += 1;
    throw new Error("temporary network timeout");
  },
});

await assert.rejects(
  failDb.execute("INSERT INTO t_retry_wal_fail (id) VALUES (1)"),
  /ERR_EXECUTION_FAILED: walrus operation failed: temporary network timeout/,
);
assert.equal(failAttempts, 3);
assert.equal(failDb.getStorageWriteLog("t_retry_wal_fail").length, 0);

let nonRetryableAttempts = 0;
const nonRetryableDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    nonRetryableAttempts += 1;
    throw new Error("bad request");
  },
});

await assert.rejects(
  nonRetryableDb.execute("INSERT INTO t_non_retry (id) VALUES (1)"),
  /ERR_EXECUTION_FAILED: walrus operation failed: bad request/,
);
assert.equal(nonRetryableAttempts, 1);

let queryAttempts = 0;
const queryDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 2 },
  onchainQueryExecutor: async () => {
    queryAttempts += 1;
    if (queryAttempts < 3) throw new Error("429 rate limit");
    return { rows: [{ ok: true }] };
  },
});

const q = await queryDb.query("SELECT ok FROM t_retry_wal");
assert.equal(q.rows.length, 1);
assert.equal(queryAttempts, 3);

console.log("ok: G-STOR-005 WAL/retry/backoff passes failure injection");
