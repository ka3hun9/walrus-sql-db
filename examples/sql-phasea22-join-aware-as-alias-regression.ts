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

  // UPDATE with AS aliases (explicit INNER JOIN) should work
  await db.execute("UPDATE users AS u INNER JOIN orders AS o ON u.id = o.user_id SET u.tier = 9 WHERE o.amount = 200");

  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 9 },
  ]);

  // DELETE with AS aliases should work
  await db.execute("DELETE u FROM users AS u INNER JOIN orders AS o ON u.id = o.user_id WHERE o.amount = 100");

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [{ id: 2, tier: 9 }]);

  // deterministic boundary still enforced under AS form
  await expectErr(
    () => db.execute("DELETE x FROM users AS u JOIN orders AS o ON u.id = o.user_id WHERE o.amount = 200"),
    "ERR_UNSUPPORTED_DELETE",
  );

  console.log("sql-phasea22-join-aware-as-alias-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
