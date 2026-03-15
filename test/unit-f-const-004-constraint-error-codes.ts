import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const expectConstraintKind = async (action: Promise<unknown>, kind: string): Promise<void> => {
  await assert.rejects(
    action,
    (err: unknown) => err instanceof Error && new RegExp(`^ERR_CONSTRAINT_VIOLATION:${kind}:`).test(err.message),
  );
};

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE errs_code (id INT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL)");
await db.execute("INSERT INTO errs_code (id, email, name) VALUES (1, 'a@x.com', 'Alice')");

await expectConstraintKind(
  db.execute("INSERT INTO errs_code (id, email, name) VALUES (2, 'a@x.com', 'Bob')"),
  "DUPLICATE_KEY",
);
await expectConstraintKind(
  db.execute("UPDATE errs_code SET name = NULL WHERE id = 1"),
  "NOT_NULL",
);
await expectConstraintKind(
  db.execute("ALTER TABLE errs_code DROP COLUMN id"),
  "PK_DROP",
);
await expectConstraintKind(
  db.execute("ALTER TABLE errs_code DROP COLUMN email"),
  "UNIQUE_DROP",
);

await db.execute("CREATE TABLE parent_code (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE child_code (id INT PRIMARY KEY, parent_id INT REFERENCES parent_code(id))");
await expectConstraintKind(
  db.execute("DROP TABLE parent_code"),
  "DDL_DEPENDENCY",
);

await db.execute("CREATE TABLE addc_code (id INT PRIMARY KEY)");
await db.execute("INSERT INTO addc_code (id) VALUES (1)");
await expectConstraintKind(
  db.execute("ALTER TABLE addc_code ADD COLUMN age INT NOT NULL"),
  "NOT_NULL_ADD_COLUMN",
);

console.log("ok: F-CONST-004 constraint errors are unified and machine-parseable");
