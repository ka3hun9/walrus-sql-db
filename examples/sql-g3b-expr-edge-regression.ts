import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id INT, amount INT, tag TEXT)");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (1, 10, 'A')");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (2, null, 'B')");
  await db.execute("INSERT INTO t (id, amount, tag) VALUES (3, 20, 'A')");

  // COALESCE in AST predicate path
  const coalesceRows = await db.query(
    "SELECT id FROM t WHERE COALESCE(amount, 0) >= 10 ORDER BY id",
  );
  assert.deepEqual(coalesceRows.rows, [{ id: 1 }, { id: 3 }]);

  // NULLIF in AST predicate path
  const nullifRows = await db.query(
    "SELECT id FROM t WHERE NULLIF(tag, 'A') IS NULL ORDER BY id",
  );
  assert.deepEqual(nullifRows.rows, [{ id: 1 }, { id: 3 }]);

  // 3VL with COALESCE fallback on nullable column
  const coalesceEqRows = await db.query(
    "SELECT id FROM t WHERE COALESCE(amount, 0) = 0 ORDER BY id",
  );
  assert.deepEqual(coalesceEqRows.rows, [{ id: 2 }]);

  console.log("sql-g3b-expr-edge-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
