import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE orders (id TEXT, amount INT, status TEXT)");
  await db.execute("INSERT INTO orders (id, amount, status) VALUES ('o1', 10, 'paid')");
  await db.execute("INSERT INTO orders (id, amount, status) VALUES ('o2', 25, 'shipped')");
  await db.execute("INSERT INTO orders (id, amount, status) VALUES ('o3', 60, 'paid')");

  const q1 = await db.query("SELECT d.id, d.amount FROM (SELECT id, amount, status FROM orders WHERE amount >= 25) d WHERE d.status = 'paid' ORDER BY d.amount DESC");
  console.log("FROM subquery =>", q1.rows);

  const q2 = await db.query("SELECT x.id FROM (SELECT id, amount FROM orders) x WHERE x.amount > 10 ORDER BY x.id ASC");
  console.log("FROM subquery simple =>", q2.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
