import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const assertState = (expected: "idle" | "active" | "committing" | "aborted"): void => {
  assert.equal(db.getTransactionState(), expected);
};

assertState("idle");

await assert.rejects(db.execute("COMMIT"), /ERR_TRANSACTION_STATE/);
assertState("idle");
await assert.rejects(db.execute("ROLLBACK"), /ERR_TRANSACTION_STATE/);
assertState("idle");

await db.execute("BEGIN");
assertState("active");
await assert.rejects(db.execute("BEGIN"), /ERR_TRANSACTION_STATE/);
assertState("active");
await db.execute("ROLLBACK");
assertState("idle");

await db.execute("BEGIN");
assertState("active");
await assert.rejects(db.execute("INSERT INTO missing_txn_state (id) VALUES (1)"), /ERR_TABLE_NOT_FOUND/);
assertState("aborted");
await assert.rejects(db.query("SELECT id FROM missing_txn_state"), /ERR_TRANSACTION_STATE/);
await assert.rejects(db.execute("COMMIT"), /ERR_TRANSACTION_STATE/);
await assert.rejects(db.execute("BEGIN"), /ERR_TRANSACTION_STATE/);
assertState("aborted");
await db.execute("ROLLBACK");
assertState("idle");

await db.execute("BEGIN");
assertState("active");
const pendingCommit = db.execute("COMMIT");
assertState("committing");
await assert.rejects(db.execute("ROLLBACK"), /ERR_TRANSACTION_STATE/);
assertState("committing");
await assert.rejects(db.execute("CREATE TABLE txn_ctx (id INT PRIMARY KEY)"), /ERR_TRANSACTION_STATE/);
assertState("committing");
await pendingCommit;
assertState("idle");

await db.execute("BEGIN");
assertState("active");
const dbAny = db as unknown as {
  transitionTransactionState: (event: string, sql: string) => unknown;
};
const originalTransition = dbAny.transitionTransactionState;
dbAny.transitionTransactionState = (event: string, sql: string): unknown => {
  if (event === "commit_done") throw new Error("forced commit_done failure");
  return originalTransition.call(db, event, sql);
};
try {
  await assert.rejects(db.execute("COMMIT"), /ERR_EXECUTION_FAILED/);
} finally {
  dbAny.transitionTransactionState = originalTransition;
}
assertState("aborted");
await db.execute("ROLLBACK");
assertState("idle");

console.log("ok: C-EXEC-008 session transaction state machine transitions");
