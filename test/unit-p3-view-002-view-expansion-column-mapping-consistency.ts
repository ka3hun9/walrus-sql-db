import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE view002_base (id INT PRIMARY KEY, dept TEXT, score INT)");
await db.execute("INSERT INTO view002_base (id, dept, score) VALUES (1, 'ENG', 91)");
await db.execute("INSERT INTO view002_base (id, dept, score) VALUES (2, 'OPS', 77)");

await db.execute(
  "CREATE VIEW view002_direct AS "
    + "SELECT view002_base.id, view002_base.dept, view002_base.score FROM view002_base",
);

{
  const rows = await db.query(
    "SELECT view002_direct.id, id, view002_direct.score FROM view002_direct ORDER BY id",
  );
  assert.deepEqual(rows.rows, [
    { "view002_direct.id": 1, id: 1, "view002_direct.score": 91 },
    { "view002_direct.id": 2, id: 2, "view002_direct.score": 77 },
  ]);
}

await db.execute(
  "CREATE VIEW view002_chain AS "
    + "SELECT view002_direct.id, view002_direct.dept, view002_direct.score FROM view002_direct",
);

{
  const star = await db.query("SELECT * FROM view002_chain ORDER BY id");
  assert.deepEqual(star.rows, [
    { id: 1, dept: "ENG", score: 91 },
    { id: 2, dept: "OPS", score: 77 },
  ]);
}

{
  const rows = await db.query(
    "SELECT view002_chain.id, id, view002_chain.dept FROM view002_chain ORDER BY id",
  );
  assert.deepEqual(rows.rows, [
    { "view002_chain.id": 1, id: 1, "view002_chain.dept": "ENG" },
    { "view002_chain.id": 2, id: 2, "view002_chain.dept": "OPS" },
  ]);
}

console.log("ok: P3-VIEW-002 view expansion rewrite and column mapping consistency");
