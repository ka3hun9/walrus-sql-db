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
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 2, 200)");

  // deterministic boundary: duplicate/conflicting aliases rejected
  await expectErr(
    () => db.execute("UPDATE users u JOIN orders u ON users.id = u.user_id SET users.tier = 9 WHERE users.id = 2"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  await expectErr(
    () => db.execute("DELETE u FROM users u JOIN orders u ON users.id = u.user_id WHERE users.id = 2"),
    "ERR_UNSUPPORTED_DELETE",
  );

  // valid distinct aliases still work
  await db.execute("UPDATE users u JOIN orders o ON u.id = o.user_id SET u.tier = 9 WHERE u.id = 2");
  const users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 9 },
  ]);

  console.log("sql-phasea20-join-aware-alias-safety-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
