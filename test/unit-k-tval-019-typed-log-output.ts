import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import type { LogEntry } from "../src/logger.js";

const logs: LogEntry[] = [];
const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  logging: {
    level: "debug",
    sink: (entry) => logs.push(entry),
  },
});

await db.execute("CREATE TABLE log_tval_019 (id INT PRIMARY KEY, name TEXT)");
await db.execute("INSERT INTO log_tval_019 (id, name) VALUES (1, 'Alice')");
await db.query("SELECT id, name FROM log_tval_019 WHERE id = 1");

const writeCoercion = logs.find((entry) => entry.level === "debug" && entry.message === "write coercion");
assert.ok(writeCoercion, "write coercion log should be emitted at debug level");
assert.match(String(writeCoercion!.meta?.inputTyped), /TypedValue<INT>\(1\)/);
assert.match(String(writeCoercion!.meta?.outputTyped), /TypedValue<INT>\(1\)/);

const querySuccess = logs.find((entry) => entry.level === "debug" && entry.message === "query success");
assert.ok(querySuccess, "query success log should be emitted");

const firstRowTyped = querySuccess!.meta?.firstRowTyped as Record<string, unknown> | undefined;
assert.ok(firstRowTyped && typeof firstRowTyped === "object", "query success log should include typed first-row preview");
assert.match(String(firstRowTyped!.id), /TypedValue<INT>\(1\)/);
assert.match(String(firstRowTyped!.name), /TypedValue<TEXT>\("Alice"\)/);

console.log("ok: K-TVAL-019 typed value log/debug output has readable type labels");
