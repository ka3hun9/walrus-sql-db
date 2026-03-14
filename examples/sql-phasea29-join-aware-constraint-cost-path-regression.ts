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

  // join-aware UPDATE on left-table target
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.email = 'c@example.com' WHERE o.amount = 100");

  // join-aware DELETE on left-table target
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 100");

  const cost = db.getConstraintIndexCost("users") as ConstraintCost;

  assert.ok(cost.updateOps > 0, `expected updateOps > 0, got ${cost.updateOps}`);
  assert.ok(cost.deleteOps > 0, `expected deleteOps > 0, got ${cost.deleteOps}`);
  assert.equal(cost.rebuildOps, 0, `expected rebuildOps=0 on join-aware DML path, got ${cost.rebuildOps}`);

  console.log("sql-phasea29-join-aware-constraint-cost-path-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
