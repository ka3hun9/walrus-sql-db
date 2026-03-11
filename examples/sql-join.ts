import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (user_id TEXT, name TEXT, tier TEXT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, status TEXT)");

  await db.execute("INSERT INTO users (user_id, name, tier) VALUES ('u1', 'Alice', 'gold')");
  await db.execute("INSERT INTO users (user_id, name, tier) VALUES ('u2', 'Bob', 'silver')");
  await db.execute("INSERT INTO users (user_id, name, tier) VALUES ('u3', 'Carol', 'gold')");

  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o1', 'u1', 10, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o2', 'u2', 25, 'shipped')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o3', 'u1', 60, 'paid')");
  await db.execute("INSERT INTO orders (id, user_id, amount, status) VALUES ('o4', 'u3', 80, 'shipped')");

  const joined = await db.query(
    "SELECT orders.id, users.name, orders.amount, users.tier FROM orders INNER JOIN users ON orders.user_id = users.user_id WHERE users.tier = 'gold' AND orders.amount >= 10 ORDER BY orders.amount DESC, orders.id ASC LIMIT 10",
  );

  console.log("JOIN result =>", joined.rows);

  const explain = await db.query(
    "EXPLAIN SELECT orders.id, users.name, orders.amount FROM orders INNER JOIN users ON orders.user_id = users.user_id WHERE users.tier = 'gold' ORDER BY orders.amount DESC LIMIT 5",
  );

  console.log("EXPLAIN JOIN =>", explain.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
