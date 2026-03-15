import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE err_layer (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO err_layer (id, v) VALUES (1, 10)");

await assert.rejects(
  db.query("SELECT id FROM err_layer WHERE"),
  (err: unknown) =>
    err instanceof SqlEngineError
    && err.family === "SQL_SYNTAX"
    && err.code.startsWith("SQL_SYNTAX_"),
);

await assert.rejects(
  db.query("SELECT id FROM err_layer WHERE missing_col = 1"),
  (err: unknown) =>
    err instanceof SqlEngineError
    && err.family === "SQL_SEMANTIC"
    && err.code === "SQL_SEMANTIC_UNKNOWN_IDENTIFIER",
);

await assert.rejects(
  db.query("SELECT IFNULL(id, 0) FROM err_layer"),
  (err: unknown) =>
    err instanceof SqlEngineError
    && err.family === "SQL_DIALECT"
    && err.code.startsWith("SQL_DIALECT_"),
);

await assert.rejects(
  db.query("SELECT id FROM not_exists_layer"),
  (err: unknown) => err instanceof Error && /^ERR_TABLE_NOT_FOUND: not_exists_layer$/.test(err.message),
);

const onchainDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "onchain",
  walrusRetry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  onchainExecutor: async () => {
    throw "transport panic";
  },
});

await assert.rejects(
  onchainDb.execute("INSERT INTO err_layer (id, v) VALUES (2, 20)"),
  (err: unknown) => err instanceof Error && /^ERR_EXECUTION_FAILED: walrus operation failed: transport panic$/.test(err.message),
);

console.log("ok: F-CONST-005 parse/semantic/execution errors are layered and stable");
