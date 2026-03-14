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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, tier INT, active BOOLEAN)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, tier, active) VALUES (1, 1, false)");
  await db.execute("INSERT INTO users (id, tier, active) VALUES (2, 2, false)");
  await db.execute("INSERT INTO users (id, tier, active) VALUES (3, 1, false)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 120)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 2, 20)");

  // UPDATE with IN subquery
  await db.execute("UPDATE users SET active = true WHERE id IN (SELECT user_id FROM orders WHERE amount >= 100)");
  const afterUpdate = await db.query("SELECT id, active FROM users ORDER BY id");
  assert.deepEqual(afterUpdate.rows, [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: false },
  ]);

  // DELETE with EXISTS subquery
  await db.execute("DELETE FROM users WHERE EXISTS (SELECT id FROM orders WHERE user_id = outer.id AND amount >= 100)");
  const afterDelete = await db.query("SELECT id FROM users ORDER BY id");
  assert.deepEqual(afterDelete.rows, [{ id: 2 }, { id: 3 }]);

  // malformed subquery should fail deterministically
  await expectErr(
    () => db.execute("UPDATE users SET active = false WHERE id IN (SELECT FROM orders)"),
    "ERR_UNSUPPORTED_SUBQUERY",
  );

  console.log("sql-phasea3-dml-subquery-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
