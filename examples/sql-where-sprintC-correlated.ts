import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id TEXT, tier INT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT)");

  await db.execute("INSERT INTO users (id, tier) VALUES ('u1', 3)");
  await db.execute("INSERT INTO users (id, tier) VALUES ('u2', 1)");

  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o1', 'u1', 10)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o2', 'u2', 20)");
  await db.execute("INSERT INTO orders (id, user_id, amount) VALUES ('o3', 'u9', 30)");

  console.log(
    "correlated IN =>",
    (await db.query("SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE tier > 1 AND id = outer.user_id) ORDER BY id")).rows,
  );

  console.log(
    "correlated EXISTS =>",
    (await db.query("SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE id = outer.user_id AND tier >= 3) ORDER BY id")).rows,
  );

  console.log(
    "correlated scalar =>",
    (await db.query("SELECT id FROM orders WHERE amount > (SELECT tier FROM users WHERE id = outer.user_id) ORDER BY id")).rows,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
