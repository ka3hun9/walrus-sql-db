import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

await import("./unit-g-stor-005-wal-retry-backoff-failure-injection.ts");

let networkAttempts = 0;
const networkDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    networkAttempts += 1;
    if (networkAttempts < 3) throw new Error("temporary network timeout");
    return { digest: "h8-network-ok", raw: { ok: true } };
  },
});

const networkRes = await networkDb.execute("INSERT INTO t_h8_network (id) VALUES (1)");
assert.equal(networkRes.txDigest, "h8-network-ok");
assert.equal(networkAttempts, 3);

let storageRetryAttempts = 0;
const storageRetryDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    storageRetryAttempts += 1;
    if (storageRetryAttempts < 2) throw new Error("temporary storage backend unavailable");
    return { digest: "h8-storage-ok", raw: { ok: true } };
  },
});

const storageRes = await storageRetryDb.execute("INSERT INTO t_h8_storage_retry (id) VALUES (1)");
assert.equal(storageRes.txDigest, "h8-storage-ok");
assert.equal(storageRetryAttempts, 2);

let timeoutAttempts = 0;
const timeoutDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  onchainQueryExecutor: async () => {
    timeoutAttempts += 1;
    throw new Error("ETIMEDOUT while reading walrus shard");
  },
});

await assert.rejects(
  timeoutDb.query("SELECT id FROM t_h8_timeout"),
  /ERR_EXECUTION_FAILED: walrus operation failed: ETIMEDOUT while reading walrus shard/,
);
assert.equal(timeoutAttempts, 3);

let storageFatalAttempts = 0;
const storageFatalDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 },
  onchainExecutor: async () => {
    storageFatalAttempts += 1;
    throw new Error("storage checksum mismatch");
  },
});

await assert.rejects(
  storageFatalDb.execute("INSERT INTO t_h8_storage_fatal (id) VALUES (1)"),
  /ERR_EXECUTION_FAILED: walrus operation failed: storage checksum mismatch/,
);
assert.equal(storageFatalAttempts, 1);
assert.equal(storageFatalDb.getStorageWriteLog("t_h8_storage_fatal").length, 0);

console.log("ok: H-TEST-008 failure injection gate (network/storage/timeout/retry)");
