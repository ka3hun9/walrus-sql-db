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
  db.resetConstraintIndexCost("orders");

  // no-op join-aware UPDATE + DELETE (WHERE misses matched rows)
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 9 WHERE o.amount = 999");
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 999");

  const usersCost = db.getConstraintIndexCost("users") as ConstraintCost;
  const ordersCost = db.getConstraintIndexCost("orders") as ConstraintCost;

  assert.equal(usersCost.updateOps, 0, `expected users.updateOps=0, got ${usersCost.updateOps}`);
  assert.equal(usersCost.deleteOps, 0, `expected users.deleteOps=0, got ${usersCost.deleteOps}`);
  assert.equal(usersCost.rebuildOps, 0, `expected users.rebuildOps=0, got ${usersCost.rebuildOps}`);
  assert.equal(usersCost.conflictChecks, 0, `expected users.conflictChecks=0, got ${usersCost.conflictChecks}`);

  // right table must remain untouched in no-op join-aware DML
  assert.equal(ordersCost.insertOps, 0, `expected orders.insertOps=0, got ${ordersCost.insertOps}`);
  assert.equal(ordersCost.updateOps, 0, `expected orders.updateOps=0, got ${ordersCost.updateOps}`);
  assert.equal(ordersCost.deleteOps, 0, `expected orders.deleteOps=0, got ${ordersCost.deleteOps}`);
  assert.equal(ordersCost.rebuildOps, 0, `expected orders.rebuildOps=0, got ${ordersCost.rebuildOps}`);
  assert.equal(ordersCost.conflictChecks, 0, `expected orders.conflictChecks=0, got ${ordersCost.conflictChecks}`);

  console.log("sql-phasea33-join-aware-noop-cost-isolation-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
