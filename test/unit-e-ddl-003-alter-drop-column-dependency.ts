import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute(
  "CREATE TABLE users_dropc (id INT PRIMARY KEY, email TEXT UNIQUE, nick TEXT, grp_a INT, grp_b INT, UNIQUE(grp_a, grp_b))",
);

await assert.rejects(
  db.execute("ALTER TABLE users_dropc DROP COLUMN id"),
  /ERR_CONSTRAINT_VIOLATION:PK_DROP/,
);

await assert.rejects(
  db.execute("ALTER TABLE users_dropc DROP COLUMN email"),
  /ERR_CONSTRAINT_VIOLATION:UNIQUE_DROP: cannot DROP UNIQUE column: email/,
);

await assert.rejects(
  db.execute("ALTER TABLE users_dropc DROP COLUMN grp_a"),
  /ERR_CONSTRAINT_VIOLATION:UNIQUE_DROP: cannot DROP column referenced by UNIQUE constraint: grp_a/,
);

await db.execute("ALTER TABLE users_dropc DROP COLUMN nick");
await db.execute("INSERT INTO users_dropc (id, email, grp_a, grp_b) VALUES (1, 'a@x.com', 10, 11)");

const q = await db.query("SELECT id, email, grp_a, grp_b FROM users_dropc ORDER BY id");
assert.deepEqual(
  q.rows.map((row) => [row.id, row.email, row.grp_a, row.grp_b]),
  [[1, "a@x.com", 10, 11]],
);

console.log("ok: E-DDL-003 ALTER TABLE DROP COLUMN dependency validation");
