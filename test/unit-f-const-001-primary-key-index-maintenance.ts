import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE pk_single (id INT PRIMARY KEY, score INT)");
await db.execute("INSERT INTO pk_single (id, score) VALUES (1, 10)");
await assert.rejects(
  db.execute("INSERT INTO pk_single (id, score) VALUES (1, 11)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

await db.execute("UPDATE pk_single SET id = 2 WHERE id = 1");
await db.execute("INSERT INTO pk_single (id, score) VALUES (1, 12)");
await assert.rejects(
  db.execute("INSERT INTO pk_single (id, score) VALUES (2, 13)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

await db.execute("DELETE FROM pk_single WHERE id = 2");
await db.execute("INSERT INTO pk_single (id, score) VALUES (2, 14)");

{
  const q = await db.query("SELECT id FROM pk_single ORDER BY id");
  assert.deepEqual(q.rows.map((row) => row.id), [1, 2]);
}

await db.execute("CREATE TABLE pk_composite (a INT, b INT, note TEXT, PRIMARY KEY(a, b))");
await db.execute("INSERT INTO pk_composite (a, b, note) VALUES (1, 1, 'x')");
await assert.rejects(
  db.execute("INSERT INTO pk_composite (a, b, note) VALUES (1, 1, 'dup')"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

await db.execute("UPDATE pk_composite SET b = 2 WHERE a = 1 AND b = 1");
await db.execute("INSERT INTO pk_composite (a, b, note) VALUES (1, 1, 'y')");

await db.execute("DELETE FROM pk_composite WHERE a = 1 AND b = 2");
await db.execute("INSERT INTO pk_composite (a, b, note) VALUES (1, 2, 'z')");

{
  const q = await db.query("SELECT a, b FROM pk_composite ORDER BY a, b");
  assert.deepEqual(
    q.rows.map((row) => [row.a, row.b]),
    [
      [1, 1],
      [1, 2],
    ],
  );
}

console.log("ok: F-CONST-001 PRIMARY KEY auto-index create/maintain on INSERT/UPDATE/DELETE");
