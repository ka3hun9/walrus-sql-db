import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (id TEXT, name TEXT, tier INT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT)");

  await db.execute("INSERT INTO users (id, name, tier) VALUES ('u1', 'Alice', 3)");
  await db.execute("INSERT INTO users (id, name, tier) VALUES ('u2', 'Bob', 2)");
  await db.execute("INSERT INTO users (id, name, tier) VALUES ('u3', 'Carol', 1)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o1', 'u1', 60)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o2', 'u2', 30)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o3', 'u9', 90)");

  console.log("EXISTS =>", (await db.query("SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE tier >= 3) ORDER BY id ASC")).rows);
  console.log("NOT EXISTS =>", (await db.query("SELECT id FROM orders WHERE NOT EXISTS (SELECT id FROM users WHERE tier > 10) ORDER BY id ASC")).rows);

  console.log("scalar subquery =>", (await db.query("SELECT id, amount FROM orders WHERE amount > (SELECT amount FROM orders WHERE id = 'o2') ORDER BY amount ASC")).rows);

  console.log("ANY =>", (await db.query("SELECT id, amount FROM orders WHERE amount > ANY (SELECT tier FROM users) ORDER BY amount ASC")).rows);
  console.log("ALL =>", (await db.query("SELECT id, amount FROM orders WHERE amount > ALL (SELECT tier FROM users) ORDER BY amount ASC")).rows);

  console.log("SOME alias =>", (await db.query("SELECT id, amount FROM orders WHERE amount > SOME (SELECT tier FROM users) ORDER BY amount ASC")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
