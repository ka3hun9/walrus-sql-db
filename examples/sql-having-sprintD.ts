import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE orders (id TEXT, buyer TEXT, amount INT, discount INT)");
  await db.execute("INSERT INTO orders (id, buyer, amount, discount) VALUES ('o1', 'alice', 100, 10)");
  await db.execute("INSERT INTO orders (id, buyer, amount, discount) VALUES ('o2', 'alice', 15, 0)");
  await db.execute("INSERT INTO orders (id, buyer, amount, discount) VALUES ('o3', 'bob', 60, NULL)");
  await db.execute("INSERT INTO orders (id, buyer, amount, discount) VALUES ('o4', 'bob', 20, 5)");

  const q0 = await db.query("SELECT buyer, SUM(amount) AS sum FROM orders GROUP BY buyer HAVING sum >= 80 ORDER BY buyer");
  console.log("having baseline(sum>=80) =>", q0.rows);

  const q1 = await db.query(
    "SELECT buyer, SUM(amount) AS sum FROM orders GROUP BY buyer HAVING CASE WHEN sum >= 80 THEN 1 ELSE 0 END = 1 ORDER BY buyer",
  );
  console.log("having case(alias) =>", q1.rows);

  const q2 = await db.query(
    "SELECT buyer, SUM(discount) AS sum FROM orders GROUP BY buyer HAVING COALESCE(sum, 0) >= 5 ORDER BY buyer",
  );
  console.log("having coalesce(alias) =>", q2.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
