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

  // multiple right-side matches for the same left row
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 1, 200)");

  db.resetConstraintIndexCost("users");

  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 9 WHERE o.amount >= 100");

  let users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, email: "a@example.com", tier: 9 },
    { id: 2, email: "b@example.com", tier: 2 },
  ]);

  const afterUpdate = db.getConstraintIndexCost("users") as ConstraintCost;
  assert.ok(afterUpdate.updateOps > 0, `expected updateOps > 0, got ${afterUpdate.updateOps}`);
  assert.equal(afterUpdate.rebuildOps, 0, `expected rebuildOps=0 after update, got ${afterUpdate.rebuildOps}`);

  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount >= 100");

  users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, email: "b@example.com", tier: 2 }]);

  const afterDelete = db.getConstraintIndexCost("users") as ConstraintCost;
  assert.ok(afterDelete.deleteOps > 0, `expected deleteOps > 0, got ${afterDelete.deleteOps}`);
  assert.equal(afterDelete.rebuildOps, 0, `expected rebuildOps=0 after delete, got ${afterDelete.rebuildOps}`);

  console.log("sql-phasea34-join-aware-dedup-target-cost-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
