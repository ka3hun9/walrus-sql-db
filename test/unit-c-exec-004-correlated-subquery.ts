import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE customers_corr (id INT PRIMARY KEY, region TEXT)");
await db.execute("CREATE TABLE orders_corr (id INT PRIMARY KEY, customer_id INT, region TEXT, amount INT)");

await db.execute("INSERT INTO customers_corr (id, region) VALUES (1, 'APAC')");
await db.execute("INSERT INTO customers_corr (id, region) VALUES (2, 'APAC')");
await db.execute("INSERT INTO customers_corr (id, region) VALUES (3, 'EU')");

await db.execute("INSERT INTO orders_corr (id, customer_id, region, amount) VALUES (10, 1, 'APAC', 60)");
await db.execute("INSERT INTO orders_corr (id, customer_id, region, amount) VALUES (11, 2, 'EU', 70)");
await db.execute("INSERT INTO orders_corr (id, customer_id, region, amount) VALUES (12, 3, 'EU', 40)");
await db.execute("INSERT INTO orders_corr (id, customer_id, region, amount) VALUES (13, 3, 'EU', 80)");

const existsRows = await db.query(
  "SELECT id FROM customers_corr WHERE EXISTS (SELECT 1 FROM orders_corr WHERE orders_corr.customer_id = outer.id AND orders_corr.region = outer.region AND amount > 50) ORDER BY id",
);
assert.deepEqual(existsRows.rows.map((r) => r.id), [1, 3]);

const inRows = await db.query(
  "SELECT id FROM customers_corr WHERE id IN (SELECT customer_id FROM orders_corr WHERE orders_corr.region = outer.region) ORDER BY id",
);
assert.deepEqual(inRows.rows.map((r) => r.id), [1, 3]);

const scalarRows = await db.query(
  "SELECT id FROM customers_corr WHERE id = (SELECT MIN(customer_id) FROM orders_corr WHERE orders_corr.region = outer.region) ORDER BY id",
);
assert.deepEqual(scalarRows.rows.map((r) => r.id), [1]);

console.log("ok: C-EXEC-004 correlated subquery outer binding");
