import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (id TEXT, city TEXT, amount INT)");
  await db.execute("INSERT INTO users (id, city, amount) VALUES ('u1', 'SH', 30)");
  await db.execute("INSERT INTO users (id, city, amount) VALUES ('u2', 'SH', 10)");
  await db.execute("INSERT INTO users (id, city, amount) VALUES ('u3', 'BJ', 20)");
  await db.execute("INSERT INTO users (id, city, amount) VALUES ('u4', 'BJ', 40)");

  const r = await db.query(
    "SELECT city, id, ROW_NUMBER() OVER (PARTITION BY city ORDER BY amount DESC) AS rn FROM users ORDER BY city, rn",
  );

  assert.deepEqual(r.rows, [
    { city: "BJ", id: "u4", rn: 1 },
    { city: "BJ", id: "u3", rn: 2 },
    { city: "SH", id: "u1", rn: 1 },
    { city: "SH", id: "u2", rn: 2 },
  ]);

  console.log("sql-g3c-window-row-number ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
