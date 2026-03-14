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
    "CREATE TABLE accounts (id INT PRIMARY KEY, code VARCHAR(4) UNIQUE, amount DECIMAL(5,2) NOT NULL, active BOOLEAN, created DATE, at TIME, ts TIMESTAMP, payload BLOB, small SMALLINT, big BIGINT, ratio DOUBLE)",
  );

  await db.execute(
    "INSERT INTO accounts (id, code, amount, active, created, at, ts, payload, small, big, ratio) VALUES (1, 'A001', 123.45, true, '2026-03-14', '09:30:00', '2026-03-14 09:30:00', '0xDEADBEEF', 12, 1234567890, 0.5)",
  );

  await db.execute(
    "INSERT INTO accounts (id, code, amount, active, created, at, ts, payload, small, big, ratio) VALUES (2, 'A002', 0.01, false, '2026-03-14', '10:00:00', '2026-03-14 10:00:00', 'blob', -1, 9, 1.25)",
  );

  await expectErr(
    () => db.execute("INSERT INTO accounts (id, code, amount) VALUES (3, 'A003', 12345.67)"),
    "ERR_TYPE_CONSTRAINT",
  );

  await expectErr(
    () => db.execute("INSERT INTO accounts (id, code, amount) VALUES (3, 'TOO-LONG', 1.23)"),
    "ERR_TYPE_CONSTRAINT",
  );

  await expectErr(
    () => db.execute("INSERT INTO accounts (id, code, amount) VALUES (3, 'A001', 1.23)"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  await expectErr(
    () => db.execute("INSERT INTO accounts (id, code, amount) VALUES (3, 'A003', NULL)"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  await expectErr(
    () => db.execute("UPDATE accounts SET amount = 123456.78 WHERE id = 1"),
    "ERR_TYPE_CONSTRAINT",
  );

  await db.execute("ALTER TABLE accounts ADD COLUMN note CHAR(3)");

  await expectErr(
    () => db.execute("ALTER TABLE accounts ADD COLUMN required_flag BOOLEAN NOT NULL"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  await expectErr(
    () => db.execute("ALTER TABLE accounts DROP COLUMN id"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  await db.execute("ALTER TABLE accounts DROP COLUMN note");
  await db.execute("DROP TABLE accounts");

  await expectErr(() => db.query("SELECT id FROM accounts"), "ERR_TABLE_NOT_FOUND");

  console.log("sql-phasea1-type-ddl-constraint-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
