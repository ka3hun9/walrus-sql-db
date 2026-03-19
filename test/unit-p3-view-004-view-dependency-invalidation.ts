import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

{
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE view_dep_users (id INT PRIMARY KEY, email TEXT, nick TEXT)");
  await db.execute("INSERT INTO view_dep_users (id, email, nick) VALUES (1, 'a@x.com', 'aa')");
  await db.execute("CREATE VIEW v_users_base AS SELECT id, email FROM view_dep_users");
  await db.execute("CREATE VIEW v_users_chain AS SELECT id, email FROM v_users_base");

  {
    const base = db.getViewCatalog("v_users_base")[0];
    assert.equal(base?.status, "ACTIVE");
    assert.deepEqual(base?.dependencies, [
      { source: "VIEW_DEP_USERS", columns: ["EMAIL", "ID"] },
    ]);
  }

  await db.execute("ALTER TABLE view_dep_users DROP COLUMN email");

  {
    const base = db.getViewCatalog("v_users_base")[0];
    const chained = db.getViewCatalog("v_users_chain")[0];
    assert.equal(base?.status, "INVALID");
    assert.match(base?.invalidReason ?? "", /base column dropped: view_dep_users\.email/i);
    assert.equal(chained?.status, "INVALID");
    assert.match(chained?.invalidReason ?? "", /dependent view invalidated after column drop: view_dep_users\.email/i);
  }

  await assert.rejects(
    db.query("SELECT * FROM v_users_base"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: V_USERS_BASE \(base column dropped: view_dep_users\.email\)/i,
  );
  await assert.rejects(
    db.query("SELECT * FROM v_users_chain"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: V_USERS_CHAIN \(dependent view invalidated after column drop: view_dep_users\.email\)/i,
  );
}

{
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE view_drop_base (id INT PRIMARY KEY, total INT)");
  await db.execute("INSERT INTO view_drop_base (id, total) VALUES (1, 10)");
  await db.execute("CREATE VIEW v_drop_base AS SELECT * FROM view_drop_base");
  await db.execute("CREATE VIEW v_drop_chain AS SELECT id FROM v_drop_base");
  await db.execute("DROP TABLE view_drop_base");

  {
    const base = db.getViewCatalog("v_drop_base")[0];
    const chained = db.getViewCatalog("v_drop_chain")[0];
    assert.equal(base?.status, "INVALID");
    assert.match(base?.invalidReason ?? "", /base table dropped: view_drop_base/i);
    assert.equal(chained?.status, "INVALID");
    assert.match(chained?.invalidReason ?? "", /dependent view invalidated after table drop: view_drop_base/i);
  }

  await assert.rejects(
    db.query("SELECT * FROM v_drop_chain"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: V_DROP_CHAIN \(dependent view invalidated after table drop: view_drop_base\)/i,
  );
}

{
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE view_drop_unrelated (id INT PRIMARY KEY, keep_col TEXT, drop_col TEXT)");
  await db.execute("INSERT INTO view_drop_unrelated (id, keep_col, drop_col) VALUES (1, 'keep', 'drop')");
  await db.execute("CREATE VIEW v_keep_active AS SELECT id, keep_col FROM view_drop_unrelated");
  await db.execute("ALTER TABLE view_drop_unrelated DROP COLUMN drop_col");

  const rows = await db.query("SELECT id, keep_col FROM v_keep_active ORDER BY id");
  assert.deepEqual(rows.rows, [{ id: 1, keep_col: "keep" }]);
  assert.equal(db.getViewCatalog("v_keep_active")[0]?.status, "ACTIVE");
}

console.log("ok: P3-VIEW-004 view dependency analysis and invalidation detection");
