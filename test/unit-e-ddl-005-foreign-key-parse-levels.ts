import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import type { TableSchema } from "../src/sql-catalog.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
const internals = db as unknown as { schemas: Map<string, TableSchema> };

await db.execute("CREATE TABLE parent_fk_parse (id INT PRIMARY KEY, code INT)");
await db.execute("CREATE TABLE child_fk_col (id INT PRIMARY KEY, parent_id INT REFERENCES parent_fk_parse(id))");

const columnLevel = internals.schemas.get("child_fk_col");
assert.deepEqual(columnLevel?.foreignKeys, [
  { columns: ["parent_id"], refTable: "parent_fk_parse", refColumns: ["id"] },
]);

await db.execute(
  "CREATE TABLE child_fk_tbl (id INT PRIMARY KEY, parent_id INT, parent_code INT, FOREIGN KEY (parent_id, parent_code) REFERENCES parent_fk_parse(id, code))",
);

const tableLevel = internals.schemas.get("child_fk_tbl");
assert.deepEqual(tableLevel?.foreignKeys, [
  { columns: ["parent_id", "parent_code"], refTable: "parent_fk_parse", refColumns: ["id", "code"] },
]);

await assert.rejects(
  db.execute(
    "CREATE TABLE child_fk_invalid (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parent_fk_parse(id, code))",
  ),
  /ERR_UNSUPPORTED_DDL: invalid FOREIGN KEY definition/,
);

console.log("ok: E-DDL-005 FOREIGN KEY parse coverage (column-level/table-level)");
