import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
const internals = db as unknown as {
  uniqueGroupValue: (row: Record<string, unknown>, group: string[]) => string | null;
};

assert.notEqual(
  internals.uniqueGroupValue({ k: 1 }, ["k"]),
  internals.uniqueGroupValue({ k: "1" }, ["k"]),
);

await db.execute("CREATE TABLE t_k13 (id INT PRIMARY KEY, code TEXT UNIQUE, score INT NOT NULL)");
await db.execute("INSERT INTO t_k13 (id, code, score) VALUES (1, 1, 10)");

await assert.rejects(
  db.execute("INSERT INTO t_k13 (id, code, score) VALUES (2, '1', 20)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY:/,
);

await assert.rejects(
  db.execute("INSERT INTO t_k13 (id, code, score) VALUES (1, 'x', 30)"),
  /ERR_CONSTRAINT_VIOLATION:DUPLICATE_KEY:/,
);

await assert.rejects(
  db.execute("INSERT INTO t_k13 (id, code, score) VALUES (3, 'z', NULL)"),
  /ERR_CONSTRAINT_VIOLATION:NOT_NULL:/,
);

console.log("ok: K-TVAL-013 typed constraint consumers for NOT NULL/UNIQUE/PK");
