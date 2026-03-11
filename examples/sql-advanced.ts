import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE orders (id TEXT, amount INT, status TEXT, buyer TEXT)");
  await db.execute("INSERT INTO orders (id, amount, status, buyer) VALUES ('o1', 10, 'paid', 'alice')");
  await db.execute("INSERT INTO orders (id, amount, status, buyer) VALUES ('o2', 25, 'shipped', 'bob')");
  await db.execute("INSERT INTO orders (id, amount, status, buyer) VALUES ('o3', 8, 'paid', 'carol')");
  await db.execute("INSERT INTO orders (id, amount, status, buyer) VALUES ('o4', 99, 'shipped', 'alice')");

  console.log("WHERE OR/IN/!=/>= =>");
  console.log(
    (
      await db.query(
        "SELECT id, amount, status FROM orders WHERE status IN ('paid','shipped') AND amount >= 10 OR buyer = 'carol' ORDER BY amount DESC, id ASC LIMIT 10 OFFSET 0",
      )
    ).rows,
  );

  console.log("Aggregates =>");
  console.log((await db.query("SELECT SUM(amount) FROM orders WHERE status != 'cancelled'")).rows);
  console.log((await db.query("SELECT AVG(amount) FROM orders WHERE status = 'shipped'")).rows);
  console.log((await db.query("SELECT MIN(amount) FROM orders")).rows);
  console.log((await db.query("SELECT MAX(amount) FROM orders")).rows);
  console.log((await db.query("SELECT COUNT(*) FROM orders WHERE status = 'paid'")).rows);

  console.log("GROUP BY + HAVING =>");
  console.log(
    (await db.query("SELECT buyer, SUM(amount) FROM orders GROUP BY buyer HAVING sum >= 20 ORDER BY sum DESC")).rows,
  );

  console.log("EXPLAIN =>");
  console.log((await db.query("EXPLAIN SELECT buyer, SUM(amount) FROM orders GROUP BY buyer HAVING sum >= 20")).rows);

  console.log("Keyset-style pagination =>");
  console.log((await db.query("SELECT id, amount FROM orders WHERE id > 'o1' ORDER BY id ASC LIMIT 2")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
