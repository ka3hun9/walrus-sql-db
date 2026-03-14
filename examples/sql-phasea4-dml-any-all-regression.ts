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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, score INT, active BOOLEAN)");
  await db.execute("CREATE TABLE limits (id INT PRIMARY KEY, v INT)");

  await db.execute("INSERT INTO users (id, score, active) VALUES (1, 40, false)");
  await db.execute("INSERT INTO users (id, score, active) VALUES (2, 60, false)");
  await db.execute("INSERT INTO users (id, score, active) VALUES (3, 90, false)");

  await db.execute("INSERT INTO limits (id, v) VALUES (1, 50)");
  await db.execute("INSERT INTO limits (id, v) VALUES (2, 80)");

  // score >= ALL(50,80) => only 90
  await db.execute("UPDATE users SET active = true WHERE score >= ALL (SELECT v FROM limits)");
  let rows = await db.query("SELECT id, active FROM users ORDER BY id");
  assert.deepEqual(rows.rows, [
    { id: 1, active: false },
    { id: 2, active: false },
    { id: 3, active: true },
  ]);

  // score < ANY(50,80) => 40 and 60
  await db.execute("DELETE FROM users WHERE score < ANY (SELECT v FROM limits)");
  rows = await db.query("SELECT id FROM users ORDER BY id");
  assert.deepEqual(rows.rows, [{ id: 3 }]);

  // malformed ANY subquery remains deterministic failure
  await expectErr(
    () => db.execute("UPDATE users SET active = false WHERE score > ANY (SELECT FROM limits)"),
    "ERR_UNSUPPORTED_SUBQUERY",
  );

  console.log("sql-phasea4-dml-any-all-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
