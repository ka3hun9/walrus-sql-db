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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(8), score INT)");
  await db.execute("INSERT INTO users (id, name, score) VALUES (1, 'alice', 10)");
  await db.execute("INSERT INTO users (id, name, score) VALUES (2, 'bob', 20)");

  // UPDATE without WHERE should be supported and affect all rows.
  await db.execute("UPDATE users SET score = 30");
  const all1 = await db.query("SELECT id, score FROM users ORDER BY id");
  assert.deepEqual(all1.rows, [
    { id: 1, score: 30 },
    { id: 2, score: 30 },
  ]);

  // DELETE without WHERE should be supported and delete all rows.
  await db.execute("DELETE FROM users");
  const empty = await db.query("SELECT id FROM users");
  assert.equal(empty.rows.length, 0);

  // ALTER malformed should fail deterministically.
  await expectErr(() => db.execute("ALTER TABLE users RENAME TO users2"), "ERR_UNSUPPORTED_DDL");

  console.log("sql-phasea2-dml-ddl-shape-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
