import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute("CREATE TABLE users_v3 (id INT PRIMARY KEY, dept_id INT, active BOOLEAN)");
await db.execute("CREATE TABLE orders_v3 (id INT PRIMARY KEY, user_id INT, total INT, status TEXT)");
await db.execute("CREATE TABLE depts_v3 (id INT PRIMARY KEY, dept_name TEXT)");

await db.execute("INSERT INTO users_v3 (id, dept_id, active) VALUES (1, 10, true)");
await db.execute("INSERT INTO users_v3 (id, dept_id, active) VALUES (2, 10, true)");
await db.execute("INSERT INTO users_v3 (id, dept_id, active) VALUES (3, 20, false)");

await db.execute("INSERT INTO orders_v3 (id, user_id, total, status) VALUES (101, 1, 50, 'PAID')");
await db.execute("INSERT INTO orders_v3 (id, user_id, total, status) VALUES (102, 1, 30, 'PENDING')");
await db.execute("INSERT INTO orders_v3 (id, user_id, total, status) VALUES (103, 2, 80, 'PAID')");
await db.execute("INSERT INTO orders_v3 (id, user_id, total, status) VALUES (104, 3, 70, 'PAID')");

await db.execute("INSERT INTO depts_v3 (id, dept_name) VALUES (10, 'ENG')");
await db.execute("INSERT INTO depts_v3 (id, dept_name) VALUES (20, 'OPS')");

await db.execute(
  "CREATE VIEW v_user_orders_v3 AS "
    + "SELECT users_v3.id AS user_id, users_v3.dept_id AS dept_id, users_v3.active AS active, "
    + "orders_v3.total AS total, orders_v3.status AS status "
    + "FROM users_v3 INNER JOIN orders_v3 ON users_v3.id = orders_v3.user_id",
);

{
  const paid = await db.query(
    "SELECT user_id, total FROM v_user_orders_v3 WHERE status = 'PAID' ORDER BY total DESC",
  );
  assert.deepEqual(paid.rows, [
    { user_id: 2, total: 80 },
    { user_id: 3, total: 70 },
    { user_id: 1, total: 50 },
  ]);
}

{
  const grouped = await db.query(
    "SELECT dept_id, SUM(total) "
      + "FROM v_user_orders_v3 WHERE status = 'PAID' GROUP BY dept_id ORDER BY sum DESC",
  );
  assert.deepEqual(grouped.rows, [
    { dept_id: 10, sum: 130 },
    { dept_id: 20, sum: 70 },
  ]);
}

{
  const joined = await db.query(
    "SELECT v_user_orders_v3.user_id, depts_v3.dept_name "
      + "FROM v_user_orders_v3 INNER JOIN depts_v3 ON v_user_orders_v3.dept_id = depts_v3.id "
      + "WHERE v_user_orders_v3.status = 'PAID' AND v_user_orders_v3.active = 'true' "
      + "ORDER BY v_user_orders_v3.user_id ASC",
  );
  assert.deepEqual(joined.rows, [
    { "v_user_orders_v3.user_id": 1, "depts_v3.dept_name": "ENG" },
    { "v_user_orders_v3.user_id": 2, "depts_v3.dept_name": "ENG" },
  ]);
}

{
  const joinViewOnRight = await db.query(
    "SELECT users_v3.id, v_user_orders_v3.total "
      + "FROM users_v3 INNER JOIN v_user_orders_v3 ON users_v3.id = v_user_orders_v3.user_id "
      + "WHERE v_user_orders_v3.status = 'PAID' ORDER BY v_user_orders_v3.total DESC",
  );
  assert.deepEqual(joinViewOnRight.rows, [
    { "users_v3.id": 2, "v_user_orders_v3.total": 80 },
    { "users_v3.id": 3, "v_user_orders_v3.total": 70 },
    { "users_v3.id": 1, "v_user_orders_v3.total": 50 },
  ]);
}

console.log("ok: P3-VIEW-003 select on view with filter/order/aggregate/join");
