import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id TEXT, v INT, name TEXT)");
  await db.execute("INSERT INTO t (id, v, name) VALUES ('a', 10, 'Alice')");
  await db.execute("INSERT INTO t (id, v, name) VALUES ('b', 20, 'Bob')");
  await db.execute("INSERT INTO t (id, v, name) VALUES ('c', 30, 'Carl')");

  console.log("NOT IN =>", (await db.query("SELECT id FROM t WHERE id NOT IN ('b') ORDER BY id ASC")).rows);
  console.log("BETWEEN =>", (await db.query("SELECT id FROM t WHERE v BETWEEN 15 AND 30 ORDER BY id ASC")).rows);
  console.log("NOT LIKE =>", (await db.query("SELECT id FROM t WHERE name NOT LIKE 'A%' ORDER BY id ASC")).rows);

  await db.execute("UPDATE t SET name = 'X' WHERE NOT (id = 'a') AND v >= 20");
  console.log("UPDATE WHERE tree =>", (await db.query("SELECT id, name FROM t ORDER BY id ASC")).rows);

  await db.execute("DELETE FROM t WHERE v NOT BETWEEN 0 AND 15");
  console.log("DELETE WHERE tree =>", (await db.query("SELECT id FROM t ORDER BY id ASC")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
