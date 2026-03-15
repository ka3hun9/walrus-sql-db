import { strict as assert } from "node:assert";
import { createClientFromConfig, loadWalrusSqlClientOptions } from "../src/config.js";

await import("./config-management-p2-smoke.ts");

const defaults = loadWalrusSqlClientOptions({
  env: {
    WALRUS_SQL_PACKAGE_ID: "0xdefaults",
  },
});

assert.equal(defaults.packageId, "0xdefaults");
assert.equal(defaults.network, "sui-testnet");
assert.equal(defaults.mode, "simulator");
assert.equal(defaults.dialect, "ansi");
assert.equal(defaults.readCache?.enabled, true);
assert.equal(defaults.readCache?.maxEntries, 256);
assert.equal(defaults.readCache?.ttlMs, 5000);
assert.equal(defaults.walrusRetry?.maxAttempts, 3);
assert.equal(defaults.walrusRetry?.baseDelayMs, 120);
assert.equal(defaults.walrusRetry?.maxDelayMs, 1500);
assert.equal(defaults.logging?.level, "error");

assert.throws(
  () =>
    loadWalrusSqlClientOptions({
      env: { WALRUS_SQL_PACKAGE_ID: "0x1", WALRUS_SQL_MODE: "broken" },
    }),
  /Invalid mode: broken/,
);

assert.throws(
  () =>
    loadWalrusSqlClientOptions({
      env: { WALRUS_SQL_PACKAGE_ID: "0x1", WALRUS_SQL_DIALECT: "oracle" },
    }),
  /Invalid dialect: oracle/,
);

assert.throws(
  () =>
    loadWalrusSqlClientOptions({
      env: { WALRUS_SQL_PACKAGE_ID: "0x1", WALRUS_SQL_LOG_LEVEL: "verbose" },
    }),
  /Invalid log level: verbose/,
);

const client = createClientFromConfig({
  env: {
    WALRUS_SQL_PACKAGE_ID: "0xenv",
    WALRUS_SQL_NETWORK: "sui-devnet",
  },
  overrides: {
    packageId: "0xoverride",
    network: "sui-mainnet",
    mode: "simulator",
  },
});

await client.execute("CREATE TABLE cfg_i2 (id INT PRIMARY KEY)");
await client.execute("INSERT INTO cfg_i2 (id) VALUES (1)");
const q = await client.query("SELECT id FROM cfg_i2 ORDER BY id");
assert.deepEqual(q.rows.map((row) => row.id), [1]);

console.log("ok: I-ENG-002 config defaults/validation/env override");
