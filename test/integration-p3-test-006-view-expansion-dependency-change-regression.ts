import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

function createDb(): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
  });
}

{
  const db = createDb();

  await db.execute("CREATE TABLE p3_test6_users (id INT PRIMARY KEY, region TEXT, email TEXT, tier INT)");
  await db.execute("CREATE TABLE p3_test6_orders (id INT PRIMARY KEY, user_id INT, amount INT, status TEXT)");

  await db.execute("INSERT INTO p3_test6_users (id, region, email, tier) VALUES (1, 'APAC', 'a@x.com', 1)");
  await db.execute("INSERT INTO p3_test6_users (id, region, email, tier) VALUES (2, 'EU', 'b@x.com', 2)");
  await db.execute("INSERT INTO p3_test6_users (id, region, email, tier) VALUES (3, 'APAC', 'c@x.com', 3)");

  await db.execute("INSERT INTO p3_test6_orders (id, user_id, amount, status) VALUES (11, 1, 90, 'PAID')");
  await db.execute("INSERT INTO p3_test6_orders (id, user_id, amount, status) VALUES (12, 1, 30, 'DRAFT')");
  await db.execute("INSERT INTO p3_test6_orders (id, user_id, amount, status) VALUES (13, 2, 70, 'PAID')");
  await db.execute("INSERT INTO p3_test6_orders (id, user_id, amount, status) VALUES (14, 3, 110, 'PAID')");

  await db.execute(
    "CREATE VIEW p3_test6_user_orders AS "
      + "SELECT p3_test6_users.id AS user_id, p3_test6_users.region AS region, p3_test6_users.email AS email, "
      + "p3_test6_orders.amount AS amount, p3_test6_orders.status AS status "
      + "FROM p3_test6_users INNER JOIN p3_test6_orders ON p3_test6_users.id = p3_test6_orders.user_id",
  );
  await db.execute(
    "CREATE VIEW p3_test6_paid_orders AS "
      + "SELECT p3_test6_user_orders.user_id, p3_test6_user_orders.region, p3_test6_user_orders.email, "
      + "p3_test6_user_orders.amount "
      + "FROM p3_test6_user_orders WHERE p3_test6_user_orders.status = 'PAID'",
  );

  const expandedRows = await db.query(
    "SELECT p3_test6_paid_orders.user_id, user_id, p3_test6_paid_orders.region, amount "
      + "FROM p3_test6_paid_orders ORDER BY user_id ASC, amount ASC",
  );
  assert.deepEqual(expandedRows.rows, [
    { "p3_test6_paid_orders.user_id": 1, user_id: 1, "p3_test6_paid_orders.region": "APAC", amount: 90 },
    { "p3_test6_paid_orders.user_id": 2, user_id: 2, "p3_test6_paid_orders.region": "EU", amount: 70 },
    { "p3_test6_paid_orders.user_id": 3, user_id: 3, "p3_test6_paid_orders.region": "APAC", amount: 110 },
  ]);

  const starRows = await db.query("SELECT * FROM p3_test6_paid_orders ORDER BY user_id ASC");
  assert.deepEqual(starRows.rows, [
    { user_id: 1, region: "APAC", email: "a@x.com", amount: 90 },
    { user_id: 2, region: "EU", email: "b@x.com", amount: 70 },
    { user_id: 3, region: "APAC", email: "c@x.com", amount: 110 },
  ]);

  await db.execute("ALTER TABLE p3_test6_users DROP COLUMN tier");

  const afterUnrelatedDrop = await db.query("SELECT user_id FROM p3_test6_paid_orders ORDER BY user_id ASC");
  assert.deepEqual(afterUnrelatedDrop.rows, [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]);
  assert.equal(db.getViewCatalog("p3_test6_user_orders")[0]?.status, "ACTIVE");
  assert.equal(db.getViewCatalog("p3_test6_paid_orders")[0]?.status, "ACTIVE");

  await db.execute("ALTER TABLE p3_test6_users DROP COLUMN email");

  {
    const base = db.getViewCatalog("p3_test6_user_orders")[0];
    const chain = db.getViewCatalog("p3_test6_paid_orders")[0];
    assert.equal(base?.status, "INVALID");
    assert.match(base?.invalidReason ?? "", /base column dropped: p3_test6_users\.email/i);
    assert.equal(chain?.status, "INVALID");
    assert.match(chain?.invalidReason ?? "", /dependent view invalidated after column drop: p3_test6_users\.email/i);
  }

  await assert.rejects(
    db.query("SELECT * FROM p3_test6_user_orders"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: P3_TEST6_USER_ORDERS \(base column dropped: p3_test6_users\.email\)/i,
  );
  await assert.rejects(
    db.query("SELECT * FROM p3_test6_paid_orders"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: P3_TEST6_PAID_ORDERS \(dependent view invalidated after column drop: p3_test6_users\.email\)/i,
  );
}

{
  const db = createDb();

  await db.execute("CREATE TABLE p3_test6_inventory (id INT PRIMARY KEY, sku TEXT, qty INT)");
  await db.execute("INSERT INTO p3_test6_inventory (id, sku, qty) VALUES (1, 'A-01', 9)");
  await db.execute("CREATE VIEW p3_test6_v_inventory AS SELECT id, sku, qty FROM p3_test6_inventory");
  await db.execute("CREATE VIEW p3_test6_v_inventory_chain AS SELECT id, sku FROM p3_test6_v_inventory");

  const beforeDrop = await db.query("SELECT * FROM p3_test6_v_inventory_chain ORDER BY id ASC");
  assert.deepEqual(beforeDrop.rows, [{ id: 1, sku: "A-01" }]);

  await db.execute("DROP TABLE p3_test6_inventory");

  {
    const base = db.getViewCatalog("p3_test6_v_inventory")[0];
    const chain = db.getViewCatalog("p3_test6_v_inventory_chain")[0];
    assert.equal(base?.status, "INVALID");
    assert.match(base?.invalidReason ?? "", /base table dropped: p3_test6_inventory/i);
    assert.equal(chain?.status, "INVALID");
    assert.match(chain?.invalidReason ?? "", /dependent view invalidated after table drop: p3_test6_inventory/i);
  }

  await assert.rejects(
    db.query("SELECT * FROM p3_test6_v_inventory_chain"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: P3_TEST6_V_INVENTORY_CHAIN \(dependent view invalidated after table drop: p3_test6_inventory\)/i,
  );
}

console.log("ok: integration P3-TEST-006 view expansion and dependency-change regression");
