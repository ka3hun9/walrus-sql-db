import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

type InternalSchema = {
  columns: Array<{ name: string }>;
};

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const internals = db as unknown as {
  tables: Map<string, Array<Record<string, unknown>>>;
  schemas: Map<string, InternalSchema>;
  transactionWriteSet: { tables: Map<string, unknown> } | null;
};

const DDL_IN_TXN_RE = /ERR_UNSUPPORTED_DDL: .*policy=forbid_ddl_in_tx/;

const assertDdlRejectedInActiveTxn = async (ddlSql: string): Promise<void> => {
  await db.execute("BEGIN");
  assert.equal(db.getTransactionState(), "active");
  assert.notEqual(internals.transactionWriteSet, null);

  await assert.rejects(db.execute(ddlSql), DDL_IN_TXN_RE);
  assert.equal(db.getTransactionState(), "aborted");
  assert.equal(internals.transactionWriteSet, null);

  await assert.rejects(db.execute("COMMIT"), /ERR_TRANSACTION_STATE/);
  assert.equal(db.getTransactionState(), "aborted");

  await db.execute("ROLLBACK");
  assert.equal(db.getTransactionState(), "idle");
  assert.equal(internals.transactionWriteSet, null);
};

await db.execute("CREATE TABLE txn_ddl_policy_base (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO txn_ddl_policy_base (id, v) VALUES (1, 10)");

await assertDdlRejectedInActiveTxn("CREATE TABLE txn_ddl_policy_new (id INT PRIMARY KEY)");
assert.equal(internals.tables.has("txn_ddl_policy_new"), false);
await assert.rejects(db.query("SELECT id FROM txn_ddl_policy_new"), /ERR_TABLE_NOT_FOUND/);

await assertDdlRejectedInActiveTxn("ALTER TABLE txn_ddl_policy_base ADD COLUMN tag TEXT DEFAULT 'x'");
assert.deepEqual(
  internals.schemas.get("txn_ddl_policy_base")?.columns.map((column) => column.name),
  ["id", "v"],
);

await assertDdlRejectedInActiveTxn("DROP TABLE txn_ddl_policy_base");
assert.equal(internals.tables.has("txn_ddl_policy_base"), true);
const rowsAfterDropAttempt = await db.query("SELECT id, v FROM txn_ddl_policy_base ORDER BY id");
assert.deepEqual(rowsAfterDropAttempt.rows, [{ id: 1, v: 10 }]);

await db.execute("CREATE TABLE txn_ddl_policy_outside (id INT PRIMARY KEY)");
await db.execute("DROP TABLE txn_ddl_policy_outside");

console.log("ok: C-EXEC-012 DDL-in-transaction policy forbids DDL and keeps runtime deterministic");
