import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE t_k15 (id INT PRIMARY KEY, v INT NOT NULL, u TEXT UNIQUE)");
await db.execute("INSERT INTO t_k15 (id, v, u) VALUES (1, 10, 'alpha')");

await assert.rejects(
  db.execute("INSERT INTO t_k15 (id, v, u) VALUES (2, true, 'beta')"),
  /typedValue=\{type=BOOLEAN,value=true,source=literal/,
);

await assert.rejects(
  db.execute("INSERT INTO t_k15 (id, v, u) VALUES (3, NULL, 'gamma')"),
  /typedValue=\{type=NULL,value=null,source=storage/,
);

await assert.rejects(
  db.execute("INSERT INTO t_k15 (id, v, u) VALUES (4, 20, 'alpha')"),
  /typedValue=\{type=TEXT,value=\"alpha\",source=storage/,
);

console.log("ok: K-TVAL-015 typed value snapshot in type/constraint errors");
