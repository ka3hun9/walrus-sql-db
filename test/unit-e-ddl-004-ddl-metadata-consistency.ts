import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE ddl_meta (id INT PRIMARY KEY, email TEXT UNIQUE)");
await assert.rejects(
  db.execute("CREATE TABLE ddl_meta (id INT PRIMARY KEY)"),
  /ERR_UNSUPPORTED_DDL: table already exists: ddl_meta/,
);

await db.execute("INSERT INTO ddl_meta (id, email) VALUES (1, 'a@x.com')");
await db.query("SELECT id, email FROM ddl_meta ORDER BY id"); // warm read cache

await db.execute("ALTER TABLE ddl_meta ADD COLUMN tag TEXT DEFAULT 'guest'");
await assert.rejects(
  db.execute("INSERT INTO ddl_meta (id, email) VALUES (2, 'a@x.com')"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);
await db.execute("INSERT INTO ddl_meta (id, email) VALUES (2, 'b@x.com')");

{
  const q = await db.query("SELECT id, tag FROM ddl_meta ORDER BY id");
  assert.deepEqual(
    q.rows.map((row) => [row.id, row.tag]),
    [
      [1, "guest"],
      [2, "guest"],
    ],
  );
}

await db.execute("ALTER TABLE ddl_meta DROP COLUMN tag");
{
  const q = await db.query("SELECT id, email FROM ddl_meta ORDER BY id");
  assert.deepEqual(
    q.rows.map((row) => [row.id, row.email]),
    [
      [1, "a@x.com"],
      [2, "b@x.com"],
    ],
  );
}

await db.execute("DROP TABLE ddl_meta");
await db.execute("CREATE TABLE ddl_meta (id INT PRIMARY KEY, email TEXT UNIQUE)");
await db.execute("INSERT INTO ddl_meta (id, email) VALUES (1, 'a@x.com')");

const q = await db.query("SELECT id, email FROM ddl_meta ORDER BY id");
assert.deepEqual(q.rows.map((row) => [row.id, row.email]), [[1, "a@x.com"]]);

console.log("ok: E-DDL-004 DDL keeps schema/index/cache metadata consistent");
