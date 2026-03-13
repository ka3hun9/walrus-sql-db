import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id TEXT, amount INT)");
  await db.execute("INSERT INTO t (id, amount) VALUES ('a', 10)");
  await db.execute("INSERT INTO t (id, amount) VALUES ('b', 20)");

  const unionDistinct = await db.query(
    "SELECT amount, id FROM t WHERE id = 'a' UNION SELECT id, amount FROM t WHERE id = 'a'",
  );
  assert.equal(unionDistinct.rows.length, 1);

  const unionAll = await db.query(
    "SELECT id FROM t WHERE amount >= 10 UNION ALL SELECT id FROM t WHERE amount >= 20 ORDER BY id",
  );
  assert.deepEqual(unionAll.rows, [{ id: "a" }, { id: "b" }, { id: "b" }]);

  const unionDistinct2 = await db.query(
    "SELECT id FROM t WHERE amount >= 10 UNION SELECT id FROM t WHERE amount >= 20 ORDER BY id",
  );
  assert.deepEqual(unionDistinct2.rows, [{ id: "a" }, { id: "b" }]);

  console.log("sql-g3c-setop-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
