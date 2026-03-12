import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE t (id TEXT, a INT, b INT, c TEXT)");
  await db.execute("INSERT INTO t (id, a, b, c) VALUES ('r1', 10, 2, NULL)");
  await db.execute("INSERT INTO t (id, a, b, c) VALUES ('r2', 4, 3, 'x')");
  await db.execute("INSERT INTO t (id, a, b, c) VALUES ('r3', 7, 0, NULL)");

  const q1 = await db.query("SELECT id FROM t WHERE a + b * 2 >= 10 ORDER BY id");
  console.log("arith where =>", q1.rows);

  const q2 = await db.query("SELECT id FROM t WHERE COALESCE(c, 'zz') = 'zz' ORDER BY id");
  console.log("coalesce where =>", q2.rows);

  const q3 = await db.query("SELECT id FROM t WHERE NULLIF(c, 'x') IS NULL ORDER BY id");
  console.log("nullif where =>", q3.rows);

  const q4 = await db.query("SELECT id FROM t WHERE CAST(a / 2 AS INT) >= 3 ORDER BY id");
  console.log("cast where =>", q4.rows);

  const q5 = await db.query("SELECT id, CASE WHEN a >= 7 THEN 'hi' ELSE 'lo' END AS level FROM t ORDER BY id");
  console.log("case select =>", q5.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
