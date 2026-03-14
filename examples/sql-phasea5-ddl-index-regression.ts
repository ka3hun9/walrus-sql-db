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

  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(32) UNIQUE, score INT)");
  await db.execute("INSERT INTO users (id, email, score) VALUES (1, 'a@x.com', 10)");
  await db.execute("INSERT INTO users (id, email, score) VALUES (2, 'b@x.com', 20)");

  // delete + reinsert same unique value (index rebuild path)
  await db.execute("DELETE FROM users WHERE id = 2");
  await db.execute("INSERT INTO users (id, email, score) VALUES (3, 'b@x.com', 30)");

  // unique conflict on update should still be caught
  await expectErr(
    () => db.execute("UPDATE users SET email = 'a@x.com' WHERE id = 3"),
    "ERR_CONSTRAINT_VIOLATION",
  );

  // unsupported DDL forms must fail deterministically
  await expectErr(
    () => db.execute("ALTER TABLE users ALTER COLUMN score INT"),
    "ERR_UNSUPPORTED_DDL",
  );
  await expectErr(
    () => db.execute("ALTER TABLE users RENAME COLUMN score TO points"),
    "ERR_UNSUPPORTED_DDL",
  );

  // unsupported duplicate ADD COLUMN
  await db.execute("ALTER TABLE users ADD COLUMN note VARCHAR(8)");
  await expectErr(
    () => db.execute("ALTER TABLE users ADD COLUMN note VARCHAR(8)"),
    "ERR_UNSUPPORTED_DDL",
  );

  console.log("sql-phasea5-ddl-index-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
