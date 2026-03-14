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

  await db.execute(
    "CREATE TABLE kv (tenant INT, id INT, code VARCHAR(8) UNIQUE, val INT, PRIMARY KEY (tenant, id), UNIQUE (tenant, val))",
  );

  await db.execute("INSERT INTO kv (tenant, id, code, val) VALUES (1, 1, 'A1', 10)");
  await db.execute("INSERT INTO kv (tenant, id, code, val) VALUES (1, 2, 'A2', 20)");
  await db.execute("INSERT INTO kv (tenant, id, code, val) VALUES (2, 1, 'B1', 10)");

  // update touches unique column, should be maintained incrementally
  await db.execute("UPDATE kv SET code = 'A2X' WHERE tenant = 1 AND id = 2");

  // old unique value released by update
  await db.execute("INSERT INTO kv (tenant, id, code, val) VALUES (2, 2, 'A2', 30)");

  // composite unique conflict after update attempt
  await expectErr(
    () => db.execute("UPDATE kv SET val = 10 WHERE tenant = 1 AND id = 2"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  // delete releases composite key slot
  await db.execute("DELETE FROM kv WHERE tenant = 1 AND id = 1");
  await db.execute("INSERT INTO kv (tenant, id, code, val) VALUES (1, 3, 'A3', 10)");

  const rows = await db.query("SELECT tenant, id, code, val FROM kv ORDER BY tenant, id");
  assert.deepEqual(rows.rows, [
    { tenant: 1, id: 2, code: "A2X", val: 20 },
    { tenant: 1, id: 3, code: "A3", val: 10 },
    { tenant: 2, id: 1, code: "B1", val: 10 },
    { tenant: 2, id: 2, code: "A2", val: 30 },
  ]);

  console.log("sql-phasea7-index-incremental-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
