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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, tier) VALUES (1, 1)");
  await db.execute("INSERT INTO users (id, tier) VALUES (2, 2)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 2, 200)");

  // ensure non-join update/delete remain supported
  await db.execute("UPDATE users SET tier = 3 WHERE id = 2");
  await db.execute("DELETE FROM orders WHERE id = 10");

  // UPDATE ... FROM remains unsupported in planning stage
  await expectErr(
    () => db.execute("UPDATE users SET tier = 9 FROM orders WHERE users.id = orders.user_id"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  // join-aware delete shapes should fail deterministically for now
  await expectErr(
    () => db.execute("DELETE users FROM users JOIN orders ON users.id = orders.user_id WHERE orders.amount > 100"),
    "ERR_UNSUPPORTED_DELETE",
  );

  await expectErr(
    () => db.execute("DELETE FROM users USING orders WHERE users.id = orders.user_id"),
    "ERR_UNSUPPORTED_DELETE",
  );

  const users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 3 },
  ]);

  const orders = await db.query("SELECT id FROM orders ORDER BY id");
  assert.deepEqual(orders.rows, [{ id: 11 }]);

  console.log("sql-phasea10-join-aware-dml-planning-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
