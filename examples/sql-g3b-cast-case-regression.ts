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
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (2, '2', 'B')");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (3, null, 'A')");

  // CAST in AST predicate path
  const castRows = await db.query(
    "SELECT id FROM t WHERE CAST(amount AS INT) >= 10 ORDER BY id",
  );
  assert.deepEqual(castRows.rows, [{ id: 1 }]);

  // CASE path still works (raw fallback path)
  const caseRows = await db.query(
    "SELECT id FROM t WHERE CASE WHEN tag = 'A' THEN 1 ELSE 0 END = 1 ORDER BY id",
  );
  assert.deepEqual(caseRows.rows, [{ id: 1 }, { id: 3 }]);

  console.log("sql-g3b-cast-case-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
