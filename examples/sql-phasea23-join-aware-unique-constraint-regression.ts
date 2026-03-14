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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, email TEXT UNIQUE, tier INT)");
  await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");

  await db.execute("INSERT INTO users (id, email, tier) VALUES (1, 'a@example.com', 1)");
  await db.execute("INSERT INTO users (id, email, tier) VALUES (2, 'b@example.com', 2)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 100)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 2, 200)");

  // join-aware UPDATE must enforce UNIQUE constraints on left-table target writes
  await expectErr(
    () => db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.email = 'b@example.com' WHERE u.id = 1"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  let users = await db.query("SELECT id, email FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ]);

  // non-conflicting update path remains valid
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.email = 'c@example.com' WHERE o.amount = 100");

  users = await db.query("SELECT id, email FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, email: "c@example.com" },
    { id: 2, email: "b@example.com" },
  ]);

  console.log("sql-phasea23-join-aware-unique-constraint-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
