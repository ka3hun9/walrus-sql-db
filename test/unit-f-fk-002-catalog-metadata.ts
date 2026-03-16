import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import type { TableSchema } from "../src/sql-catalog.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
const internals = db as unknown as { schemas: Map<string, TableSchema> };

await db.execute("CREATE TABLE parent_fk_meta (id INT PRIMARY KEY, code INT)");

await db.execute(
  "CREATE TABLE child_fk_meta (id INT PRIMARY KEY, parent_id INT, parent_code INT, FOREIGN KEY (parent_id, parent_code) REFERENCES parent_fk_meta(id, code) MATCH FULL ON DELETE CASCADE ON UPDATE RESTRICT)",
);
await db.execute(
  "CREATE TABLE child_fk_meta_col (id INT PRIMARY KEY, parent_id INT REFERENCES parent_fk_meta(id) ON UPDATE CASCADE ON DELETE SET NULL)",
);

const tableLevelFk = internals.schemas.get("child_fk_meta")?.foreignKeys;
assert.deepEqual(tableLevelFk, [
  {
    columns: ["parent_id", "parent_code"],
    refTable: "parent_fk_meta",
    refColumns: ["id", "code"],
    matchRule: "FULL",
    onDelete: "CASCADE",
    onUpdate: "RESTRICT",
  },
]);

const columnLevelFk = internals.schemas.get("child_fk_meta_col")?.foreignKeys;
assert.deepEqual(columnLevelFk, [
  {
    columns: ["parent_id"],
    refTable: "parent_fk_meta",
    refColumns: ["id"],
    matchRule: "SIMPLE",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  },
]);

await db.execute(
  "CREATE TABLE child_fk_meta_default (id INT PRIMARY KEY, parent_id INT REFERENCES parent_fk_meta(id))",
);
const defaultFk = internals.schemas.get("child_fk_meta_default")?.foreignKeys;
assert.deepEqual(defaultFk, [
  {
    columns: ["parent_id"],
    refTable: "parent_fk_meta",
    refColumns: ["id"],
    matchRule: "SIMPLE",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  },
]);

console.log("ok: F-FK-002 catalog FK metadata (match rule / update-delete actions)");
