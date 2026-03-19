import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

{
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE view005_src_a (id INT PRIMARY KEY)");
  await db.execute("CREATE TABLE view005_conflict_name (id INT PRIMARY KEY)");
  await assert.rejects(
    db.execute("CREATE VIEW view005_conflict_name AS SELECT id FROM view005_src_a"),
    /ERR_UNSUPPORTED_DDL: name conflict with existing table: view005_conflict_name/i,
  );
}

{
  const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE view005_src_b (id INT PRIMARY KEY)");
  await db.execute("CREATE VIEW view005_view_name AS SELECT id FROM view005_src_b");
  await assert.rejects(
    db.execute("CREATE TABLE view005_view_name (id INT PRIMARY KEY)"),
    /ERR_UNSUPPORTED_DDL: name conflict with existing view: view005_view_name/i,
  );
}

{
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    viewPolicy: { allowCreate: false },
  });
  await db.execute("CREATE TABLE view005_src_c (id INT PRIMARY KEY)");
  await assert.rejects(
    db.execute("CREATE VIEW view005_denied_create AS SELECT id FROM view005_src_c"),
    /ERR_UNSUPPORTED_DDL: CREATE VIEW denied by view policy: VIEW005_DENIED_CREATE/i,
  );
}

{
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    viewPolicy: { allowSelect: false },
  });
  await db.execute("CREATE TABLE view005_src_d (id INT PRIMARY KEY, score INT)");
  await db.execute("INSERT INTO view005_src_d (id, score) VALUES (1, 88)");
  await db.execute("CREATE VIEW view005_denied_select AS SELECT id, score FROM view005_src_d");
  await assert.rejects(
    db.query("SELECT id, score FROM view005_denied_select"),
    /ERR_UNSUPPORTED_SELECT: SELECT VIEW denied by view policy: VIEW005_DENIED_SELECT/i,
  );
}

{
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    viewPolicy: { allowDrop: false },
  });
  await db.execute("CREATE TABLE view005_src_e (id INT PRIMARY KEY)");
  await db.execute("CREATE VIEW view005_denied_drop AS SELECT id FROM view005_src_e");
  await assert.rejects(
    db.execute("DROP VIEW view005_denied_drop"),
    /ERR_UNSUPPORTED_DDL: DROP VIEW denied by view policy: VIEW005_DENIED_DROP/i,
  );
}

{
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    viewPolicy: { allowedViewNames: ["view005_allowed"] },
  });
  await db.execute("CREATE TABLE view005_src_f (id INT PRIMARY KEY)");
  await db.execute("CREATE VIEW view005_allowed AS SELECT id FROM view005_src_f");
  const rows = await db.query("SELECT id FROM view005_allowed ORDER BY id");
  assert.deepEqual(rows.rows, []);
  await assert.rejects(
    db.execute("CREATE VIEW view005_blocked AS SELECT id FROM view005_src_f"),
    /ERR_UNSUPPORTED_DDL: CREATE VIEW denied by allowed view list: VIEW005_BLOCKED/i,
  );
}

console.log("ok: P3-VIEW-005 view permission and naming conflict baseline policy");
