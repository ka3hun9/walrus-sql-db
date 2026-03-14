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

  await db.execute("INSERT INTO users (id, tier) VALUES (1, 1)");
  await db.execute("INSERT INTO users (id, tier) VALUES (2, 2)");

  // self-join update deterministic unsupported
  await expectErr(
    () => db.execute("UPDATE users u JOIN users x ON u.id = x.id SET u.tier = 5 WHERE u.id = 2"),
    "ERR_UNSUPPORTED_UPDATE",
  );

  // self-join delete deterministic unsupported
  await expectErr(
    () => db.execute("DELETE u FROM users u JOIN users x ON u.id = x.id WHERE u.id = 1"),
    "ERR_UNSUPPORTED_DELETE",
  );

  const users = await db.query("SELECT id, tier FROM users ORDER BY id");
  assert.deepEqual(users.rows, [
    { id: 1, tier: 1 },
    { id: 2, tier: 2 },
  ]);

  console.log("sql-phasea21-join-aware-self-join-boundary-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
