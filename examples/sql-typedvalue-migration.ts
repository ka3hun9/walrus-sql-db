import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute("CREATE TABLE mig_tval (id INT PRIMARY KEY, score FLOAT, ok BOOLEAN, note TEXT DEFAULT 'n/a')");
await db.execute("INSERT INTO mig_tval (id, score, ok) VALUES ('1', '12.5', 'true')");
await db.execute("INSERT INTO mig_tval (id, score, ok, note) VALUES (2, 7.25, false, 99)");
await db.execute("UPDATE mig_tval SET score = '18.75' WHERE id = '2'");

const rows = await db.query("SELECT id, score, ok, note FROM mig_tval ORDER BY id");
assert.deepEqual(rows.rows, [
  { id: 1, score: 12.5, ok: true, note: "n/a" },
  { id: 2, score: 18.75, ok: false, note: "99" },
]);

await assert.rejects(
  db.execute("INSERT INTO mig_tval (id, score, ok) VALUES (3, 'Infinity', true)"),
  /ERR_TYPE_CONSTRAINT: expected numeric for FLOAT/,
);

console.log("sql-typedvalue-migration ok");
