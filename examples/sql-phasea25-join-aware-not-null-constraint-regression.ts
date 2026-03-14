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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, tier INT NOT NULL)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, tier) VALUES (1, 1)");
  await db.execute("INSERT INTO users (id, tier) VALUES (2, 2)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");

  // join-aware UPDATE should still enforce NOT NULL on left-table writes
  await expectErr(
    () => db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = NULL WHERE o.amount = 100"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  // valid non-null write remains allowed
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 7 WHERE o.amount = 100");

  const users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 7 },
    { id: 2, tier: 2 },
  ]);

  console.log("sql-phasea25-join-aware-not-null-constraint-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
