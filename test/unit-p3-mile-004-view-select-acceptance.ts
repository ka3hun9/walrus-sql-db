import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { WalrusSqlClient } from "../src/client.js";

function createDb(options?: ConstructorParameters<typeof WalrusSqlClient>[0]): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
    ...options,
  });
}

{
  const db = createDb();

  await db.execute("CREATE TABLE p3_mile4_users (id INT PRIMARY KEY, dept_id INT, email TEXT, active BOOLEAN)");
  await db.execute("CREATE TABLE p3_mile4_orders (id INT PRIMARY KEY, user_id INT, amount INT, status TEXT)");
  await db.execute("CREATE TABLE p3_mile4_depts (id INT PRIMARY KEY, dept_name TEXT)");

  await db.execute("INSERT INTO p3_mile4_users (id, dept_id, email, active) VALUES (1, 10, 'u1@x.com', true)");
  await db.execute("INSERT INTO p3_mile4_users (id, dept_id, email, active) VALUES (2, 10, 'u2@x.com', true)");
  await db.execute("INSERT INTO p3_mile4_users (id, dept_id, email, active) VALUES (3, 20, 'u3@x.com', false)");

  await db.execute("INSERT INTO p3_mile4_orders (id, user_id, amount, status) VALUES (101, 1, 50, 'PAID')");
  await db.execute("INSERT INTO p3_mile4_orders (id, user_id, amount, status) VALUES (102, 1, 30, 'DRAFT')");
  await db.execute("INSERT INTO p3_mile4_orders (id, user_id, amount, status) VALUES (103, 2, 80, 'PAID')");
  await db.execute("INSERT INTO p3_mile4_orders (id, user_id, amount, status) VALUES (104, 3, 70, 'PAID')");

  await db.execute("INSERT INTO p3_mile4_depts (id, dept_name) VALUES (10, 'ENG')");
  await db.execute("INSERT INTO p3_mile4_depts (id, dept_name) VALUES (20, 'OPS')");

  await db.execute(
    "CREATE VIEW p3_mile4_user_orders AS "
      + "SELECT p3_mile4_users.id AS user_id, p3_mile4_users.dept_id AS dept_id, p3_mile4_users.email AS email, "
      + "p3_mile4_orders.amount AS amount, p3_mile4_orders.status AS status "
      + "FROM p3_mile4_users INNER JOIN p3_mile4_orders ON p3_mile4_users.id = p3_mile4_orders.user_id",
  );
  await db.execute(
    "CREATE VIEW p3_mile4_paid_orders AS "
      + "SELECT p3_mile4_user_orders.user_id, p3_mile4_user_orders.dept_id, p3_mile4_user_orders.email, "
      + "p3_mile4_user_orders.amount "
      + "FROM p3_mile4_user_orders WHERE p3_mile4_user_orders.status = 'PAID'",
  );

  const paidRows = await db.query(
    "SELECT user_id, amount FROM p3_mile4_user_orders WHERE status = 'PAID' ORDER BY amount DESC",
  );
  assert.deepEqual(paidRows.rows, [
    { user_id: 2, amount: 80 },
    { user_id: 3, amount: 70 },
    { user_id: 1, amount: 50 },
  ]);

  const groupedRows = await db.query(
    "SELECT dept_id, SUM(amount) "
      + "FROM p3_mile4_user_orders WHERE status = 'PAID' GROUP BY dept_id ORDER BY sum DESC",
  );
  assert.deepEqual(groupedRows.rows, [
    { dept_id: 10, sum: 130 },
    { dept_id: 20, sum: 70 },
  ]);

  const joinedRows = await db.query(
    "SELECT p3_mile4_paid_orders.user_id AS user_id, p3_mile4_depts.dept_name AS dept_name "
      + "FROM p3_mile4_paid_orders INNER JOIN p3_mile4_depts ON p3_mile4_paid_orders.dept_id = p3_mile4_depts.id "
      + "ORDER BY user_id ASC",
  );
  assert.deepEqual(joinedRows.rows, [
    { user_id: 1, dept_name: "ENG" },
    { user_id: 2, dept_name: "ENG" },
    { user_id: 3, dept_name: "OPS" },
  ]);

  const chainRows = await db.query("SELECT user_id FROM p3_mile4_paid_orders ORDER BY user_id ASC");
  assert.deepEqual(chainRows.rows, [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]);
  assert.equal(db.getViewCatalog("p3_mile4_user_orders")[0]?.status, "ACTIVE");
  assert.equal(db.getViewCatalog("p3_mile4_paid_orders")[0]?.status, "ACTIVE");

  await db.execute("ALTER TABLE p3_mile4_users DROP COLUMN active");

  const afterUnrelatedDrop = await db.query("SELECT user_id FROM p3_mile4_paid_orders ORDER BY user_id ASC");
  assert.deepEqual(afterUnrelatedDrop.rows, [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]);
  assert.equal(db.getViewCatalog("p3_mile4_user_orders")[0]?.status, "ACTIVE");
  assert.equal(db.getViewCatalog("p3_mile4_paid_orders")[0]?.status, "ACTIVE");

  await db.execute("ALTER TABLE p3_mile4_users DROP COLUMN email");

  {
    const base = db.getViewCatalog("p3_mile4_user_orders")[0];
    const chain = db.getViewCatalog("p3_mile4_paid_orders")[0];
    assert.equal(base?.status, "INVALID");
    assert.match(base?.invalidReason ?? "", /base column dropped: p3_mile4_users\.email/i);
    assert.equal(chain?.status, "INVALID");
    assert.match(chain?.invalidReason ?? "", /dependent view invalidated after column drop: p3_mile4_users\.email/i);
  }

  await assert.rejects(
    db.query("SELECT * FROM p3_mile4_paid_orders"),
    /ERR_UNSUPPORTED_SELECT: view is invalid: P3_MILE4_PAID_ORDERS \(dependent view invalidated after column drop: p3_mile4_users\.email\)/i,
  );
}

{
  const db = createDb();

  await db.execute("CREATE TABLE p3_mile4_base (id INT PRIMARY KEY, qty INT)");
  await db.execute("CREATE TABLE p3_mile4_sink (id INT PRIMARY KEY, qty INT)");
  await db.execute("INSERT INTO p3_mile4_base (id, qty) VALUES (1, 10)");
  await db.execute("INSERT INTO p3_mile4_sink (id, qty) VALUES (1, 99)");
  await db.execute("CREATE VIEW p3_mile4_readonly AS SELECT id, qty FROM p3_mile4_base");

  await assert.rejects(
    db.execute("INSERT INTO p3_mile4_readonly (id, qty) VALUES (2, 20)"),
    /ERR_UNSUPPORTED_INSERT: updatable view is deferred in Phase 3: INSERT target cannot reference view P3_MILE4_READONLY/i,
  );
  await assert.rejects(
    db.execute("UPDATE p3_mile4_readonly SET qty = 20 WHERE id = 1"),
    /ERR_UNSUPPORTED_UPDATE: updatable view is deferred in Phase 3: UPDATE target cannot reference view P3_MILE4_READONLY/i,
  );
  await assert.rejects(
    db.execute("DELETE FROM p3_mile4_readonly WHERE id = 1"),
    /ERR_UNSUPPORTED_DELETE: updatable view is deferred in Phase 3: DELETE target cannot reference view P3_MILE4_READONLY/i,
  );

  const baseRows = await db.query("SELECT id, qty FROM p3_mile4_base ORDER BY id ASC");
  assert.deepEqual(baseRows.rows, [{ id: 1, qty: 10 }]);

  const sinkRows = await db.query("SELECT id, qty FROM p3_mile4_sink ORDER BY id ASC");
  assert.deepEqual(sinkRows.rows, [{ id: 1, qty: 99 }]);

  const viewRows = await db.query("SELECT id, qty FROM p3_mile4_readonly ORDER BY id ASC");
  assert.deepEqual(viewRows.rows, [{ id: 1, qty: 10 }]);
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-004\b/.test(checklist), false, "P3-MILE-004 must be checked");

const report = readFileSync("docs/sql-p3-mile-004-view-select-acceptance-report.md", "utf8");
assert.ok(report.includes("## P3-MILE-004"));
assert.ok(report.includes("SELECT"));
assert.ok(report.includes("ERR_UNSUPPORTED_INSERT"));
assert.ok(report.includes("PASS"));

console.log("ok: P3-MILE-004 view SELECT acceptance (updatable views deferred)");
