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

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 2, 50)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 2, 200)");

  // first-cut join-aware delete: target left rows matched by JOIN + WHERE on left row
  await db.execute("DELETE users FROM users JOIN orders ON users.id = orders.user_id WHERE id = 2");

  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 3, tier: 3 },
  ]);

  // unmatched rows should remain when join has no hit
  await db.execute("DELETE users FROM users JOIN orders ON users.id = orders.user_id WHERE id = 1");
  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 3, tier: 3 },
  ]);

  // USING remains unsupported deterministic boundary
  await expectErr(
    () => db.execute("DELETE FROM users USING orders WHERE users.id = orders.user_id"),
    "ERR_UNSUPPORTED_DELETE",
  );

  console.log("sql-phasea12-join-aware-delete-exec-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
