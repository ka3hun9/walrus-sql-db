import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE uq_single (id INT PRIMARY KEY, email TEXT UNIQUE, nick TEXT)");
await db.execute("INSERT INTO uq_single (id, email, nick) VALUES (1, 'a@x.com', 'A')");
await db.execute("INSERT INTO uq_single (id, email, nick) VALUES (2, 'b@x.com', 'B')");

await assert.rejects(
  db.execute("INSERT INTO uq_single (id, email, nick) VALUES (3, 'a@x.com', 'C')"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);
await assert.rejects(
  db.execute("UPDATE uq_single SET email = 'a@x.com' WHERE id = 2"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

// SQL-style UNIQUE behavior: NULL values do not collide.
await db.execute("INSERT INTO uq_single (id, email, nick) VALUES (4, NULL, 'N1')");
await db.execute("INSERT INTO uq_single (id, email, nick) VALUES (5, NULL, 'N2')");

await db.execute("CREATE TABLE uq_composite (id INT PRIMARY KEY, a INT, b INT, UNIQUE(a, b))");
await db.execute("INSERT INTO uq_composite (id, a, b) VALUES (1, 10, 20)");
await db.execute("INSERT INTO uq_composite (id, a, b) VALUES (2, 10, 30)");

await assert.rejects(
  db.execute("INSERT INTO uq_composite (id, a, b) VALUES (3, 10, 20)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);
await assert.rejects(
  db.execute("UPDATE uq_composite SET b = 20 WHERE id = 2"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

const q = await db.query("SELECT id, a, b FROM uq_composite ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.a, row.b]),
  [
    [1, 10, 20],
    [2, 10, 30],
  ],
);

console.log("ok: F-CONST-002 UNIQUE collision detection (single/composite)");
