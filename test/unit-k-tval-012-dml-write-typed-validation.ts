import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";
import { fromLiteral } from "../src/types.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const internals = db as unknown as {
  coerceByType: (type: { name: "INT" }, value: unknown, sourceContext?: string) => unknown;
};

assert.equal(internals.coerceByType({ name: "INT" }, fromLiteral("7"), "k12.typed"), 7);
assert.throws(
  () => internals.coerceByType({ name: "INT" }, 7, "k12.bypass"),
  /ERR_TYPE_CONSTRAINT: write binding must be TypedValue/,
);

await db.execute("CREATE TABLE t_k12 (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO t_k12 (id, v) VALUES (1, 1)");
await db.execute("UPDATE t_k12 SET v = 2 WHERE id = 1");

await assert.rejects(
  db.execute("INSERT INTO t_k12 (id, v) VALUES (2, true)"),
  /ERR_TYPE_CONSTRAINT: implicit cast BOOLEAN -> INT not allowed/,
);

const q = await db.query("SELECT id, v FROM t_k12 ORDER BY id");
assert.deepEqual(q.rows, [{ id: 1, v: 2 }]);

console.log("ok: K-TVAL-012 insert/update pre-write validation via typed bindings");
