import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

const legacyFallbackError = new Error("legacy primitive fallback should not run");
const internals = db as unknown as Record<string, unknown>;
internals.compare = () => {
  throw legacyFallbackError;
};
internals.eq = () => {
  throw legacyFallbackError;
};

const compareByOp = (left: unknown, right: unknown, op: "=" | "!=" | "<>" | ">" | "<" | ">=" | "<="): "TRUE" | "FALSE" | "UNKNOWN" =>
  (internals.compareByOp as (leftValue: unknown, rightValue: unknown, compareOp: string) => "TRUE" | "FALSE" | "UNKNOWN")
    .call(db, left, right, op);
const compareForOrder = (left: unknown, right: unknown, direction: "ASC" | "DESC"): number =>
  (internals.compareForOrder as (leftValue: unknown, rightValue: unknown, orderDirection: "ASC" | "DESC") => number)
    .call(db, left, right, direction);

assert.equal(compareByOp(10, "2", ">"), "TRUE");
assert.equal(compareByOp(10, "10", "="), "TRUE");
assert.equal(compareByOp(true, "1", "="), "TRUE");
assert.equal(compareForOrder(10, "2", "ASC"), 1);
assert.equal(compareForOrder(10, "2", "DESC"), -1);

await db.execute("CREATE TABLE k_tval_021 (id INT PRIMARY KEY, score INT)");
await db.execute("INSERT INTO k_tval_021 (id, score) VALUES (1, 20)");
await db.execute("INSERT INTO k_tval_021 (id, score) VALUES (2, 10)");

const result = await db.query("SELECT id FROM k_tval_021 WHERE id >= '1' ORDER BY score ASC");
assert.deepEqual(
  result.rows.map((row) => row.id),
  [2, 1],
);

console.log("ok: K-TVAL-021 remove primitive fallback path and keep typed-only compare/order");
