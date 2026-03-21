import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE idx_meta_users (id INT PRIMARY KEY, email TEXT UNIQUE, tenant_id INT)");

{
  const all = db.getIndexCatalog();
  assert.ok(all.length >= 2);
  const pk = all.find((entry) => entry.table === "idx_meta_users" && entry.columns.length === 1 && entry.columns[0] === "id");
  const uq = all.find((entry) => entry.table === "idx_meta_users" && entry.columns.length === 1 && entry.columns[0] === "email");
  assert.ok(pk);
  assert.ok(uq);
  assert.equal(pk?.type, "HASH");
  assert.equal(pk?.unique, true);
  assert.equal(pk?.status, "ACTIVE");
}

await db.execute("ALTER TABLE idx_meta_users ADD COLUMN org_id INT");
{
  const tableOnly = db.getIndexCatalog("idx_meta_users");
  assert.ok(tableOnly.some((entry) => entry.columns.join(",") === "id"));
  assert.ok(tableOnly.some((entry) => entry.columns.join(",") === "email"));
}

await db.execute("DROP TABLE idx_meta_users");
{
  const tableOnly = db.getIndexCatalog("idx_meta_users");
  assert.equal(tableOnly.length, 0);
}

console.log("ok: P3-IDX-002 index catalog metadata lifecycle");
