import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (user_id TEXT, name TEXT, tier TEXT, city TEXT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, status TEXT)");

  await db.execute("INSERT INTO users (user_id, name, tier, city) VALUES ('u1', 'Alice', 'gold', 'Shanghai')");
  await db.execute("INSERT INTO users (user_id, name, tier, city) VALUES ('u2', 'Bob', 'silver', 'Shenzhen')");
  await db.execute("INSERT INTO users (user_id, name, tier, city) VALUES ('u3', 'Carol', 'gold', null)");

  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o1', 'u1', 10, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o2', 'u2', 25, 'shipped')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o3', 'u1', 60, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o4', 'u9', 80, 'orphan')");

  console.log("P0 LEFT JOIN + NULL/LIKE =>");
  console.log(
    (
      await db.query(
        "SELECT orders.id, users.name, users.city FROM orders LEFT JOIN users ON orders.user_id = users.user_id WHERE users.name LIKE 'A%' OR users.city IS NULL ORDER BY orders.id ASC",
      )
    ).rows,
  );

  console.log("P1 subquery IN + UNION ALL =>");
  console.log(
    (
      await db.query(
        "SELECT id, amount FROM orders WHERE user_id IN (SELECT user_id FROM users) UNION ALL SELECT id, amount FROM orders WHERE status = 'orphan'",
      )
    ).rows,
  );

  console.log("P2 window-like row number =>");
  console.log((await db.query("SELECT id, amount, ROW_NUMBER() OVER (ORDER BY amount DESC) AS rn FROM orders ORDER BY amount DESC")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
