import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE uu (id TEXT, amount INT)");
  await db.execute("INSERT INTO uu (id, amount) VALUES ('a', 10)");
  await db.execute("INSERT INTO uu (id, amount) VALUES ('b', 20)");

  const distinctByLeftSchema = await db.query(
    "SELECT amount AS a, id AS b FROM uu WHERE id = 'a' UNION SELECT amount AS x, id AS y FROM uu WHERE id = 'a'",
  );
  assert.deepEqual(distinctByLeftSchema.rows, [{ a: 10, b: "a" }]);

  const unionAllByLeftSchema = await db.query(
    "SELECT amount AS a, id AS b FROM uu WHERE id = 'a' UNION ALL SELECT id AS x, amount AS y FROM uu WHERE id = 'b'",
  );
  assert.deepEqual(unionAllByLeftSchema.rows, [
    { a: 10, b: "a" },
    { a: "b", b: 20 },
  ]);

  const orderByLeftSchema = await db.query(
    "SELECT amount AS a, id AS b FROM uu UNION SELECT id AS x, amount AS y FROM uu ORDER BY a, b",
  );
  assert.deepEqual(orderByLeftSchema.rows, [
    { a: 10, b: "a" },
    { a: 20, b: "b" },
    { a: "a", b: 10 },
    { a: "b", b: 20 },
  ]);

  console.log("sql-g3d-setop-projection-order-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
