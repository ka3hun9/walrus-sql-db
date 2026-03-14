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

  // first-cut join-aware update: derive target rows from INNER JOIN pairs, then apply SET
  await db.execute("UPDATE users JOIN orders ON users.id = orders.user_id SET tier = 9");

  let users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 9 },
    { id: 3, tier: 3 },
  ]);

  // WHERE still applies on target side rows
  await db.execute("UPDATE users JOIN orders ON users.id = orders.user_id SET tier = 8 WHERE id = 2");

  users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 8 },
    { id: 3, tier: 3 },
  ]);

  // UPDATE ... FROM remains unsupported for deterministic boundary
  await expectErr(
    () => db.execute("UPDATE users SET tier = 9 FROM orders WHERE users.id = orders.user_id"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  console.log("sql-phasea11-join-aware-dml-exec-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
