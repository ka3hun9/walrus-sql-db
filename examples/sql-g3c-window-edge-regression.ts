import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE scores (id TEXT, city TEXT, amount INT)");
  await db.execute("INSERT INTO scores (id, city, amount) VALUES ('a', 'SH', 10)");
  await db.execute("INSERT INTO scores (id, city, amount) VALUES ('b', 'SH', 10)");
  await db.execute("INSERT INTO scores (id, city, amount) VALUES ('c', 'SH', NULL)");
  await db.execute("INSERT INTO scores (id, city, amount) VALUES ('d', 'BJ', 5)");
  await db.execute("INSERT INTO scores (id, city, amount) VALUES ('e', 'BJ', NULL)");

  const tie = await db.query(
    "SELECT city, id, amount, ROW_NUMBER() OVER (PARTITION BY city ORDER BY amount DESC, id ASC) AS rn FROM scores ORDER BY city, rn",
  );

  assert.deepEqual(tie.rows, [
    { city: "BJ", id: "d", amount: 5, rn: 1 },
    { city: "BJ", id: "e", amount: null, rn: 2 },
    { city: "SH", id: "a", amount: 10, rn: 1 },
    { city: "SH", id: "b", amount: 10, rn: 2 },
    { city: "SH", id: "c", amount: null, rn: 3 },
  ]);

  console.log("sql-g3c-window-edge-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
