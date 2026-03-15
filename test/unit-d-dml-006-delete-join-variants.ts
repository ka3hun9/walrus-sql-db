import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const seed = async (suffix: string): Promise<{ users: string; orders: string }> => {
  const users = `users_delj_${suffix}`;
  const orders = `orders_delj_${suffix}`;
  await db.execute(`CREATE TABLE ${users} (id INT PRIMARY KEY, tier INT)`);
  await db.execute(`CREATE TABLE ${orders} (id INT PRIMARY KEY, user_id INT, amount INT)`);

  await db.execute(`INSERT INTO ${users} (id, tier) VALUES (1, 10)`);
  await db.execute(`INSERT INTO ${users} (id, tier) VALUES (2, 20)`);
  await db.execute(`INSERT INTO ${users} (id, tier) VALUES (3, 30)`);

  await db.execute(`INSERT INTO ${orders} (id, user_id, amount) VALUES (10, 1, 100)`);
  await db.execute(`INSERT INTO ${orders} (id, user_id, amount) VALUES (11, 2, 40)`);
  await db.execute(`INSERT INTO ${orders} (id, user_id, amount) VALUES (12, 4, 80)`);
  return { users, orders };
};

{
  const { users, orders } = await seed("inner");
  const r = await db.execute(
    `DELETE ${users} FROM ${users} u INNER JOIN ${orders} o ON u.id = o.user_id WHERE o.amount >= 60`,
  );
  assert.equal(r.affectedRows, 1);
  const q = await db.query(`SELECT id FROM ${users} ORDER BY id`);
  assert.deepEqual(q.rows.map((row) => row.id), [2, 3]);
}

{
  const { users, orders } = await seed("left");
  const r = await db.execute(
    `DELETE u FROM ${users} u LEFT JOIN ${orders} o ON u.id = o.user_id WHERE o.user_id IS NULL`,
  );
  assert.equal(r.affectedRows, 1);
  const q = await db.query(`SELECT id FROM ${users} ORDER BY id`);
  assert.deepEqual(q.rows.map((row) => row.id), [1, 2]);
}

{
  const { users, orders } = await seed("right");
  const r = await db.execute(
    `DELETE u FROM ${users} u RIGHT JOIN ${orders} o ON u.id = o.user_id WHERE o.amount >= 60`,
  );
  assert.equal(r.affectedRows, 1);
  const q = await db.query(`SELECT id FROM ${users} ORDER BY id`);
  assert.deepEqual(q.rows.map((row) => row.id), [2, 3]);
}

{
  const { users, orders } = await seed("full");
  const r = await db.execute(
    `DELETE u FROM ${users} u FULL OUTER JOIN ${orders} o ON u.id = o.user_id WHERE o.user_id IS NULL`,
  );
  assert.equal(r.affectedRows, 1);
  const q = await db.query(`SELECT id FROM ${users} ORDER BY id`);
  assert.deepEqual(q.rows.map((row) => row.id), [1, 2]);
}

console.log("ok: D-DML-006 DELETE JOIN variants (INNER/LEFT/RIGHT/FULL OUTER)");
