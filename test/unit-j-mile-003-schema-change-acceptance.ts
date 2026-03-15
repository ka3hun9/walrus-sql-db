import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE parent_j3 (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE child_j3 (id INT PRIMARY KEY, parent_id INT REFERENCES parent_j3(id))");

await db.execute("INSERT INTO parent_j3 (id, name) VALUES (1, 'root')");
await db.execute("INSERT INTO child_j3 (id, parent_id) VALUES (10, 1)");

await db.execute("ALTER TABLE parent_j3 ADD COLUMN tier INT NOT NULL DEFAULT 1");
{
  const q = await db.query("SELECT id, tier FROM parent_j3 ORDER BY id");
  assert.deepEqual(q.rows.map((row) => [row.id, row.tier]), [[1, 1]]);
}

await db.execute("ALTER TABLE parent_j3 DROP COLUMN name");
{
  const q = await db.query("SELECT id, tier FROM parent_j3 ORDER BY id");
  assert.deepEqual(q.rows.map((row) => [row.id, row.tier]), [[1, 1]]);
}

await assert.rejects(
  db.execute("DROP TABLE parent_j3"),
  /ERR_CONSTRAINT_VIOLATION:DDL_DEPENDENCY/,
);

await db.execute("DROP TABLE child_j3");
await db.execute("DROP TABLE parent_j3");

await assert.rejects(
  db.query("SELECT * FROM parent_j3"),
  /ERR_TABLE_NOT_FOUND: parent_j3/,
);

console.log("ok: J-MILE-003 schema change acceptance (DROP/ALTER full path)");
