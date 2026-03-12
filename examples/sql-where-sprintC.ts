import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE t (id TEXT, name TEXT, score INT, flag TEXT)");
  await db.execute("INSERT INTO t (id, name, score, flag) VALUES ('u1', 'A_1', 10, 'TRUE')");
  await db.execute("INSERT INTO t (id, name, score, flag) VALUES ('u2', 'A%2', 20, 'FALSE')");
  await db.execute("INSERT INTO t (id, name, score, flag) VALUES ('u3', 'Alice', NULL, NULL)");

  console.log("LIKE ESCAPE _ =>", (await db.query("SELECT id FROM t WHERE name LIKE 'A\\_%' ESCAPE '\\' ORDER BY id")).rows);
  console.log("LIKE ESCAPE % =>", (await db.query("SELECT id FROM t WHERE name LIKE 'A\\%%' ESCAPE '\\' ORDER BY id")).rows);
  console.log("IS NOT DISTINCT FROM =>", (await db.query("SELECT id FROM t WHERE score IS NOT DISTINCT FROM NULL ORDER BY id")).rows);
  console.log("ALL empty semantics =>", (await db.query("SELECT id FROM t WHERE score > ALL (SELECT score FROM t WHERE id = '__none__') ORDER BY id")).rows);
  console.log("ANY empty semantics =>", (await db.query("SELECT id FROM t WHERE score > ANY (SELECT score FROM t WHERE id = '__none__') ORDER BY id")).rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
