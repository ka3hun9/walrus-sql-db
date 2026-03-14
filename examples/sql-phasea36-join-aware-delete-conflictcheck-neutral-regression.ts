import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

type ConstraintCost = {
  insertOps: number;
  updateOps: number;
  deleteOps: number;
  rebuildOps: number;
  conflictChecks: number;
  rowsIndexed: number;
};

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, email TEXT UNIQUE, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, email, tier) VALUES (1, 'a@example.com', 1)");
  await db.execute("INSERT INTO users (id, email, tier) VALUES (2, 'b@example.com', 2)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");

  db.resetConstraintIndexCost("users");

  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 100");

  const users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, email: "b@example.com", tier: 2 }]);

  const cost = db.getConstraintIndexCost("users") as ConstraintCost;
  assert.ok(cost.deleteOps > 0, `expected deleteOps > 0, got ${cost.deleteOps}`);
  assert.equal(cost.conflictChecks, 0, `expected conflictChecks=0 on delete path, got ${cost.conflictChecks}`);
  assert.equal(cost.rebuildOps, 0, `expected rebuildOps=0 on delete path, got ${cost.rebuildOps}`);

  console.log("sql-phasea36-join-aware-delete-conflictcheck-neutral-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
