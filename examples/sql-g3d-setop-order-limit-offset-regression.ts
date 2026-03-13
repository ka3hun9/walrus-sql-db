import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE ul (id TEXT, amount INT)");
  await db.execute("INSERT INTO ul (id, amount) VALUES ('a', 10)");
  await db.execute("INSERT INTO ul (id, amount) VALUES ('b', 20)");
  await db.execute("INSERT INTO ul (id, amount) VALUES ('c', 30)");

  const orderedDistinct = await db.query(
    "SELECT amount AS v FROM ul WHERE amount <= 20 UNION SELECT amount AS x FROM ul WHERE amount >= 20 ORDER BY v DESC LIMIT 2 OFFSET 0",
  );
  assert.deepEqual(orderedDistinct.rows, [{ v: 30 }, { v: 20 }]);

  const orderedAllPaged = await db.query(
    "SELECT amount AS v FROM ul WHERE amount <= 20 UNION ALL SELECT amount AS x FROM ul WHERE amount >= 20 ORDER BY v ASC LIMIT 3 OFFSET 1",
  );
  assert.deepEqual(orderedAllPaged.rows, [{ v: 20 }, { v: 20 }, { v: 30 }]);

  console.log("sql-g3d-setop-order-limit-offset-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
