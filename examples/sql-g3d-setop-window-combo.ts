import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE tx (id TEXT, city TEXT, amount INT)");
  await db.execute("INSERT INTO tx (id, city, amount) VALUES ('a', 'SH', 30)");
  await db.execute("INSERT INTO tx (id, city, amount) VALUES ('b', 'SH', 10)");
  await db.execute("INSERT INTO tx (id, city, amount) VALUES ('c', 'BJ', 20)");
  await db.execute("INSERT INTO tx (id, city, amount) VALUES ('d', 'BJ', 40)");

  const unionAllWindow = await db.query(
    "SELECT g, id, score, ROW_NUMBER() OVER (PARTITION BY g ORDER BY score DESC, id ASC) AS rn FROM (SELECT city AS g, id, amount AS score FROM tx WHERE city = 'SH' UNION ALL SELECT city AS g, id, amount AS score FROM tx WHERE city = 'BJ') u ORDER BY g, rn",
  );

  assert.deepEqual(unionAllWindow.rows, [
    { g: "BJ", id: "d", score: 40, rn: 1 },
    { g: "BJ", id: "c", score: 20, rn: 2 },
    { g: "SH", id: "a", score: 30, rn: 1 },
    { g: "SH", id: "b", score: 10, rn: 2 },
  ]);

  const unionDistinctWindow = await db.query(
    "SELECT g, id, score, ROW_NUMBER() OVER (PARTITION BY g ORDER BY score DESC, id ASC) AS rn FROM (SELECT city AS g, id, amount AS score FROM tx UNION SELECT city AS g, id, amount AS score FROM tx) u ORDER BY g, rn",
  );

  assert.deepEqual(unionDistinctWindow.rows, [
    { g: "BJ", id: "d", score: 40, rn: 1 },
    { g: "BJ", id: "c", score: 20, rn: 2 },
    { g: "SH", id: "a", score: 30, rn: 1 },
    { g: "SH", id: "b", score: 10, rn: 2 },
  ]);

  console.log("sql-g3d-setop-window-combo ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
