import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { SqlEngineError } from "../src/sql-errors.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE err_ctx (id INT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL)");

await assert.rejects(
  db.query("SELECT IFNULL(id, 0) FROM err_ctx"),
  (err: unknown) =>
    err instanceof SqlEngineError
    && typeof err.details?.token === "string"
    && err.details.token.toUpperCase() === "IFNULL",
);

await assert.rejects(
  db.execute("INSERT INTO err_ctx (id, email, name) VALUES (1, 'a@x.com', NULL)"),
  (err: unknown) =>
    err instanceof Error
    && /ERR_CONSTRAINT_VIOLATION:NOT_NULL:/.test(err.message)
    && /clause=NOT NULL/.test(err.message)
    && /field=err_ctx\.name/.test(err.message),
);

await db.execute("INSERT INTO err_ctx (id, email, name) VALUES (1, 'a@x.com', 'Alice')");
await assert.rejects(
  db.execute("INSERT INTO err_ctx (id, email, name) VALUES (2, 'a@x.com', 'Bob')"),
  (err: unknown) =>
    err instanceof Error
    && /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY:/.test(err.message)
    && /clause=UNIQUE/.test(err.message)
    && /field=email/.test(err.message),
);

await assert.rejects(
  db.execute("ALTER TABLE err_ctx DROP COLUMN id"),
  (err: unknown) =>
    err instanceof Error
    && /ERR_CONSTRAINT_VIOLATION:PK_DROP:/.test(err.message)
    && /clause=ALTER TABLE DROP COLUMN/.test(err.message)
    && /field=id/.test(err.message),
);

console.log("ok: F-CONST-006 error payloads include token/clause/field context");
