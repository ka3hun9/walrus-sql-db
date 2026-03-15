import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import type { LogEntry } from "../src/logger.js";

const debugLogs: LogEntry[] = [];
const debugDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  logging: {
    level: "debug",
    sink: (entry) => debugLogs.push(entry),
  },
});

await debugDb.execute("CREATE TABLE log_i1 (id INT PRIMARY KEY, name TEXT)");
await debugDb.execute("INSERT INTO log_i1 (id, name) VALUES (1, 'Alice')");
await debugDb.query("SELECT id, name FROM log_i1 WHERE id = 1");
await assert.rejects(
  debugDb.execute("INSERT INTO log_i1 (id, name) VALUES (1, 'Dup')"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);
await assert.rejects(
  debugDb.query("SELECT id FROM missing_log_i1"),
  /ERR_TABLE_NOT_FOUND: missing_log_i1/,
);

const debugMessages = debugLogs.map((entry) => `${entry.level}:${entry.message}`);
assert.ok(debugMessages.includes("debug:execute start"));
assert.ok(debugMessages.includes("debug:execute success"));
assert.ok(debugMessages.includes("debug:query start"));
assert.ok(debugMessages.includes("debug:query success"));
assert.ok(debugMessages.includes("error:execute failed"));
assert.ok(debugMessages.includes("error:query failed"));

const warnLogs: LogEntry[] = [];
let retryAttempts = 0;
const warnDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  logging: {
    level: "warn",
    sink: (entry) => warnLogs.push(entry),
  },
  onchainExecutor: async () => {
    retryAttempts += 1;
    if (retryAttempts < 3) throw new Error("temporary network timeout");
    return { digest: "log-retry-ok", raw: { ok: true } };
  },
});

await warnDb.execute("INSERT INTO log_retry_i1 (id) VALUES (1)");
assert.equal(retryAttempts, 3);
assert.ok(warnLogs.some((entry) => entry.level === "warn" && entry.message === "walrus retry"));
assert.equal(warnLogs.some((entry) => entry.level === "debug"), false);

console.log("ok: I-ENG-001 configurable log levels + key-path log coverage");
