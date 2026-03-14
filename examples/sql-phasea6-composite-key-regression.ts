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
    "CREATE TABLE memberships (tenant_id INT, user_id INT, role VARCHAR(8), PRIMARY KEY (tenant_id, user_id), UNIQUE (tenant_id, role))",
  );

  await db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 10, 'owner')");
  await db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 11, 'admin')");
  await db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (2, 10, 'owner')");

  // duplicate composite PK
  await expectErr(
    () => db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 10, 'guest')"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  // duplicate composite UNIQUE(tenant_id, role)
  await expectErr(
    () => db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 12, 'owner')"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  // after delete, composite slot can be reused
  await db.execute("DELETE FROM memberships WHERE tenant_id = 1 AND user_id = 11");
  await db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 12, 'admin')");

  const rows = await db.query("SELECT tenant_id, user_id, role FROM memberships ORDER BY tenant_id, user_id");
  assert.deepEqual(rows.rows, [
    { tenant_id: 1, user_id: 10, role: "owner" },
    { tenant_id: 1, user_id: 12, role: "admin" },
    { tenant_id: 2, user_id: 10, role: "owner" },
  ]);

  console.log("sql-phasea6-composite-key-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
