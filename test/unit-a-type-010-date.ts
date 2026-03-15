import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_date (id INT PRIMARY KEY, d DATE)");

await db.execute("INSERT INTO t_date (id, d) VALUES (1, '2024-02-29')");
await db.execute("INSERT INTO t_date (id, d) VALUES (2, '2023-12-31')");

const q = await db.query("SELECT id, d FROM t_date ORDER BY id");
assert.equal(q.rows.length, 2);
assert.equal(q.rows[0]!.d, "2024-02-29");
assert.equal(q.rows[1]!.d, "2023-12-31");

await assert.rejects(
  db.execute("INSERT INTO t_date (id, d) VALUES (3, '2023-02-29')"),
  /ERR_TYPE_CONSTRAINT: invalid DATE: 2023-02-29/,
);
await assert.rejects(
  db.execute("INSERT INTO t_date (id, d) VALUES (4, '2024-04-31')"),
  /ERR_TYPE_CONSTRAINT: invalid DATE: 2024-04-31/,
);
await assert.rejects(
  db.execute("INSERT INTO t_date (id, d) VALUES (5, '2024-13-01')"),
  /ERR_TYPE_CONSTRAINT: invalid DATE: 2024-13-01/,
);
await assert.rejects(
  db.execute("INSERT INTO t_date (id, d) VALUES (6, '2024/01/01')"),
  /ERR_TYPE_CONSTRAINT: invalid DATE: 2024\/01\/01/,
);

console.log("ok: A-TYPE-010 DATE format and validity checks");
