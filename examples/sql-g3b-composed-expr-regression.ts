import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id INT, amount TEXT, tag TEXT)");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (1, '10', 'A')");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (2, null, 'B')");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (3, '7', null)");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (4, '2', 'A')");

  // Combined expression path: CAST + COALESCE + NULLIF
  const comboRows = await db.query(
    "SELECT id FROM t WHERE CAST(COALESCE(amount, '0') AS INT) >= 7 AND NULLIF(tag, 'B') IS NOT NULL ORDER BY id",
  );
  assert.deepEqual(comboRows.rows, [{ id: 1 }]);

  // UNKNOWN propagation through composed predicate
  const unknownRows = await db.query(
    "SELECT id FROM t WHERE NULLIF(tag, 'A') = 'Z' ORDER BY id",
  );
  assert.deepEqual(unknownRows.rows, []);

  // Mixed OR path keeps TRUE rows even with UNKNOWN branch
  const mixedOrRows = await db.query(
    "SELECT id FROM t WHERE NULLIF(tag, 'A') = 'Z' OR CAST(COALESCE(amount, '0') AS INT) > 9 ORDER BY id",
  );
  assert.deepEqual(mixedOrRows.rows, [{ id: 1 }]);

  console.log("sql-g3b-composed-expr-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
