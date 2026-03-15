import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_ord (id INT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL)");
await db.execute("INSERT INTO users_ord (id, email, name) VALUES (1, 'a@x.com', 'Alice')");
await db.execute("INSERT INTO users_ord (id, email, name) VALUES (2, 'b@x.com', 'Bob')");

// Repeated duplicate-key failures must be side-effect free for UPDATE.
await assert.rejects(
  db.execute("UPDATE users_ord SET email = 'b@x.com' WHERE id = 1"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);
await assert.rejects(
  db.execute("UPDATE users_ord SET email = 'b@x.com' WHERE id = 1"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY/,
);

{
  const q = await db.query("SELECT id, email, name FROM users_ord ORDER BY id");
  assert.deepEqual(
    q.rows.map((row) => [row.id, row.email, row.name]),
    [
      [1, "a@x.com", "Alice"],
      [2, "b@x.com", "Bob"],
    ],
  );
}

// After DELETE removes the conflicting row, the same UPDATE should succeed.
await db.execute("DELETE FROM users_ord WHERE id = 2");
const promoted = await db.execute("UPDATE users_ord SET email = 'b@x.com' WHERE id = 1");
assert.equal(promoted.affectedRows, 1);

// UPDATE index swap should free old unique key for later INSERT.
await db.execute("INSERT INTO users_ord (id, email, name) VALUES (3, 'a@x.com', 'Ann')");

// Repeated NOT NULL failures must also be side-effect free.
await assert.rejects(
  db.execute("UPDATE users_ord SET name = NULL WHERE id = 3"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);
await assert.rejects(
  db.execute("UPDATE users_ord SET name = NULL WHERE id = 3"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL/,
);

// DELETE should release unique key so it can be reused immediately.
await db.execute("DELETE FROM users_ord WHERE id = 1");
await db.execute("INSERT INTO users_ord (id, email, name) VALUES (4, 'b@x.com', 'Bert')");

const q = await db.query("SELECT id, email, name FROM users_ord ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.email, row.name]),
  [
    [3, "a@x.com", "Ann"],
    [4, "b@x.com", "Bert"],
  ],
);

console.log("ok: D-DML-007 DML constraint-check order is deterministic and repeatable");
