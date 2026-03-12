import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id TEXT, a INT, b INT, c TEXT, flag TEXT)");
  await db.execute("INSERT INTO t (id, a, b, c, flag) VALUES ('r1', 1, 2, 'Alice', 'TRUE')");
  await db.execute("INSERT INTO t (id, a, b, c, flag) VALUES ('r2', 2, NULL, 'Bob', 'FALSE')");
  await db.execute("INSERT INTO t (id, a, b, c, flag) VALUES ('r3', NULL, 3, NULL, NULL)");

  console.log("NULL compare (=) =>", (await db.query("SELECT id FROM t WHERE a = NULL ORDER BY id")).rows);
  console.log("IS NULL =>", (await db.query("SELECT id FROM t WHERE a IS NULL ORDER BY id")).rows);
  console.log("NOT IN with NULL =>", (await db.query("SELECT id FROM t WHERE a NOT IN (2, NULL) ORDER BY id")).rows);
  console.log("BETWEEN with NULL bound =>", (await db.query("SELECT id FROM t WHERE a BETWEEN NULL AND 5 ORDER BY id")).rows);
  console.log("LIKE with NULL =>", (await db.query("SELECT id FROM t WHERE c LIKE NULL ORDER BY id")).rows);
  console.log("IS TRUE =>", (await db.query("SELECT id FROM t WHERE flag IS TRUE ORDER BY id")).rows);
  console.log("IS NOT FALSE =>", (await db.query("SELECT id FROM t WHERE flag IS NOT FALSE ORDER BY id")).rows);
  console.log("IS DISTINCT FROM =>", (await db.query("SELECT id FROM t WHERE a IS DISTINCT FROM NULL ORDER BY id")).rows);

  await db.execute("UPDATE t SET c = 'X' WHERE a = NULL OR id = 'r1'");
  console.log("UPDATE 3VL =>", (await db.query("SELECT id, c FROM t ORDER BY id")).rows);

  await db.execute("DELETE FROM t WHERE a NOT IN (2, NULL)");
  console.log("DELETE 3VL =>", (await db.query("SELECT id FROM t ORDER BY id")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
