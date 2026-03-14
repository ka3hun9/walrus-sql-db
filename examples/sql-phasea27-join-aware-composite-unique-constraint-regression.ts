import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, org_id INT, code INT, tier INT, UNIQUE(org_id, code))");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, org_id, code, tier) VALUES (1, 10, 100, 1)");
  await db.execute("INSERT INTO users (id, org_id, code, tier) VALUES (2, 10, 200, 2)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");

  // join-aware UPDATE should enforce composite UNIQUE(org_id, code)
  await expectErr(
    () => db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.code = 200 WHERE o.amount = 100"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  let users = await db.query("SELECT id, org_id, code, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, org_id: 10, code: 100, tier: 1 },
    { id: 2, org_id: 10, code: 200, tier: 2 },
  ]);

  // non-conflicting composite key write remains valid
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.code = 300 WHERE o.amount = 100");

  users = await db.query("SELECT id, org_id, code, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, org_id: 10, code: 300, tier: 1 },
    { id: 2, org_id: 10, code: 200, tier: 2 },
  ]);

  console.log("sql-phasea27-join-aware-composite-unique-constraint-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
