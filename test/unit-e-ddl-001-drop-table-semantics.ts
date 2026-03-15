import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await assert.rejects(
  db.execute("DROP TABLE not_exists_ddl1"),
  /ERR_TABLE_NOT_FOUND: not_exists_ddl1/,
);

await db.execute("CREATE TABLE parent_ddl1 (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE child_ddl1 (id INT PRIMARY KEY, parent_id INT REFERENCES parent_ddl1(id))");

await assert.rejects(
  db.execute("DROP TABLE parent_ddl1"),
  /ERR_UNSUPPORTED_DDL: cannot DROP TABLE parent_ddl1: referenced by child_ddl1\(parent_id\)/,
);

await db.execute("DROP TABLE child_ddl1");
await db.execute("DROP TABLE parent_ddl1");

await assert.rejects(
  db.query("SELECT * FROM parent_ddl1"),
  /ERR_TABLE_NOT_FOUND: parent_ddl1/,
);

console.log("ok: E-DDL-001 DROP TABLE not-found/dependency semantics");
