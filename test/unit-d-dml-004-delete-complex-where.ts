import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE users_del (id INT PRIMARY KEY, age INT, code TEXT)");
await db.execute("INSERT INTO users_del (id, age, code) VALUES (1, 25, 'A_1')");
await db.execute("INSERT INTO users_del (id, age, code) VALUES (2, 35, 'A11')");
await db.execute("INSERT INTO users_del (id, age, code) VALUES (3, 28, 'B_1')");
await db.execute("INSERT INTO users_del (id, age, code) VALUES (4, 40, 'A_4')");

await db.execute("DELETE FROM users_del WHERE age BETWEEN 20 AND 30");
await db.execute("DELETE FROM users_del WHERE code LIKE 'A!_%' ESCAPE '!'");
await db.execute("DELETE FROM users_del WHERE id IN (2)");

const leftMain = await db.query("SELECT id FROM users_del ORDER BY id");
assert.equal(leftMain.rows.length, 0);

await db.execute("CREATE TABLE users_del_ex (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE orders_del_ex (id INT PRIMARY KEY, user_id INT, amount INT)");
await db.execute("INSERT INTO users_del_ex (id) VALUES (1)");
await db.execute("INSERT INTO users_del_ex (id) VALUES (2)");
await db.execute("INSERT INTO users_del_ex (id) VALUES (3)");
await db.execute("INSERT INTO orders_del_ex (id, user_id, amount) VALUES (10, 1, 100)");
await db.execute("INSERT INTO orders_del_ex (id, user_id, amount) VALUES (11, 3, 50)");

await db.execute(
  "DELETE FROM users_del_ex WHERE EXISTS (SELECT 1 FROM orders_del_ex WHERE orders_del_ex.user_id = outer.id AND amount > 80)",
);

const leftExists = await db.query("SELECT id FROM users_del_ex ORDER BY id");
assert.deepEqual(leftExists.rows.map((r) => r.id), [2, 3]);

console.log("ok: D-DML-004 DELETE complex WHERE predicates");
