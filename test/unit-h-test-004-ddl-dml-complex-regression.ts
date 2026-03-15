import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const regressionSuites = [
  "./unit-d-dml-001-update-complex-where.ts",
  "./unit-d-dml-002-update-subquery-where.ts",
  "./unit-d-dml-003-update-join-variants.ts",
  "./unit-d-dml-004-delete-complex-where.ts",
  "./unit-d-dml-005-delete-subquery-where.ts",
  "./unit-d-dml-006-delete-join-variants.ts",
  "./unit-d-dml-007-dml-constraint-order.ts",
  "./unit-e-ddl-001-drop-table-semantics.ts",
  "./unit-e-ddl-002-alter-add-column-default-not-null.ts",
  "./unit-e-ddl-003-alter-drop-column-dependency.ts",
  "./unit-e-ddl-004-ddl-metadata-consistency.ts",
];

for (const suite of regressionSuites) {
  await import(suite);
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_h4r (id INT PRIMARY KEY, name TEXT, tier INT)");
await db.execute("CREATE TABLE orders_h4r (id INT PRIMARY KEY, user_id INT, amount INT)");

await db.execute("INSERT INTO users_h4r (id, name, tier) VALUES (1, 'Alice', 0)");
await db.execute("INSERT INTO users_h4r (id, name, tier) VALUES (2, 'Bob', 0)");
await db.execute("INSERT INTO users_h4r (id, name, tier) VALUES (3, 'Cara', 0)");

await db.execute("INSERT INTO orders_h4r (id, user_id, amount) VALUES (10, 1, 100)");
await db.execute("INSERT INTO orders_h4r (id, user_id, amount) VALUES (11, 2, 60)");

await db.execute("ALTER TABLE users_h4r ADD COLUMN score INT NOT NULL DEFAULT 0");
await db.execute("UPDATE users_h4r SET score = 1 WHERE id IN (SELECT user_id FROM orders_h4r WHERE amount >= 50)");
await db.execute(
  "UPDATE users_h4r u INNER JOIN orders_h4r o ON u.id = o.user_id SET u.tier = 8 WHERE o.amount >= 60",
);
await db.execute("DELETE FROM users_h4r WHERE id = (SELECT MIN(user_id) FROM orders_h4r WHERE amount >= 100)");
await db.execute(
  "DELETE u FROM users_h4r u LEFT JOIN orders_h4r o ON u.id = o.user_id WHERE o.user_id IS NULL",
);

{
  const q = await db.query("SELECT id, name, tier, score FROM users_h4r ORDER BY id");
  assert.deepEqual(
    q.rows.map((row) => [row.id, row.name, row.tier, row.score]),
    [[2, "Bob", 8, 1]],
  );
}

await db.execute("ALTER TABLE users_h4r DROP COLUMN score");

{
  const q = await db.query("SELECT id, name, tier FROM users_h4r ORDER BY id");
  assert.deepEqual(
    q.rows.map((row) => [row.id, row.name, row.tier]),
    [[2, "Bob", 8]],
  );
}

console.log("ok: H-TEST-004 DDL/DML complex regression set (subquery + JOIN)");
