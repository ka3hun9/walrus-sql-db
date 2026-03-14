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
  await db.execute("INSERT INTO users (id, tier) VALUES (3, 3)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 2, 200)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 3, 50)");

  // alias + qualified fields in ON/WHERE for join-aware UPDATE
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET tier = 7 WHERE o.amount = 200 AND u.id = 2");

  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 7 },
    { id: 3, tier: 3 },
  ]);

  // qualified left target in SET should be accepted
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 8 WHERE o.amount = 200 AND u.id = 2");

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 8 },
    { id: 3, tier: 3 },
  ]);

  // deterministic boundary: SET target cannot point to right-side alias
  await expectErr(
    () => db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET o.amount = 999 WHERE u.id = 2"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  // alias target + qualified fields for join-aware DELETE
  await db.execute("DELETE u FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 200 AND u.id = 2");

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 3, tier: 3 },
  ]);

  // deterministic boundary: delete target must be left table or alias
  await expectErr(
    () => db.execute("DELETE x FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount = 50"),
    "ERR_UNSUPPORTED_DELETE",
  );

  console.log("sql-phasea13-join-aware-alias-qualified-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
