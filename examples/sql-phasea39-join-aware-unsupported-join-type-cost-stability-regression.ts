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

function expectErr(fn: () => unknown | Promise<unknown>, code: string) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      throw new Error(`expected ${code} but succeeded`);
    })
    .catch((e) => {
      const msg = (e as Error)?.message ?? String(e);
      assert.ok(msg.includes(`${code}:`), `expected ${code}, got: ${msg}`);
    });
}

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, email TEXT UNIQUE, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, email, tier) VALUES (1, 'a@example.com', 1)");
  await db.execute("INSERT INTO users (id, email, tier) VALUES (2, 'b@example.com', 2)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");

  db.resetConstraintIndexCost("users");
  db.resetConstraintIndexCost("orders");

  await expectErr(
    () => db.execute("UPDATE users u LEFT JOIN orders o ON u.id = o.user_id SET u.tier = 9 WHERE o.amount = 100"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  await expectErr(
    () => db.execute("DELETE u FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE o.amount = 100"),
    "ERR_UNSUPPORTED_DELETE",
  );

  const users = await db.query("SELECT id, email, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, email: "a@example.com", tier: 1 },
    { id: 2, email: "b@example.com", tier: 2 },
  ]);

  const usersCost = db.getConstraintIndexCost("users") as ConstraintCost;
  const ordersCost = db.getConstraintIndexCost("orders") as ConstraintCost;

  assert.equal(usersCost.updateOps, 0, `expected users.updateOps=0, got ${usersCost.updateOps}`);
  assert.equal(usersCost.deleteOps, 0, `expected users.deleteOps=0, got ${usersCost.deleteOps}`);
  assert.equal(usersCost.rebuildOps, 0, `expected users.rebuildOps=0, got ${usersCost.rebuildOps}`);
  assert.equal(usersCost.conflictChecks, 0, `expected users.conflictChecks=0, got ${usersCost.conflictChecks}`);

  assert.equal(ordersCost.insertOps, 0, `expected orders.insertOps=0, got ${ordersCost.insertOps}`);
  assert.equal(ordersCost.updateOps, 0, `expected orders.updateOps=0, got ${ordersCost.updateOps}`);
  assert.equal(ordersCost.deleteOps, 0, `expected orders.deleteOps=0, got ${ordersCost.deleteOps}`);
  assert.equal(ordersCost.rebuildOps, 0, `expected orders.rebuildOps=0, got ${ordersCost.rebuildOps}`);
  assert.equal(ordersCost.conflictChecks, 0, `expected orders.conflictChecks=0, got ${ordersCost.conflictChecks}`);

  console.log("sql-phasea39-join-aware-unsupported-join-type-cost-stability-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
