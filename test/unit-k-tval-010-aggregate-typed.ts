import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_k10 (id INT PRIMARY KEY, v FLOAT)");
await db.execute("INSERT INTO t_k10 (id, v) VALUES (1, 1.5)");
await db.execute("INSERT INTO t_k10 (id, v) VALUES (2, 2.5)");
await db.execute("INSERT INTO t_k10 (id, v) VALUES (3, NULL)");

const sum = await db.query("SELECT SUM(v) FROM t_k10");
assert.equal(sum.rows[0]!.sum, 4);

const avg = await db.query("SELECT AVG(v) FROM t_k10");
assert.equal(avg.rows[0]!.avg, 2);

const min = await db.query("SELECT MIN(v) FROM t_k10");
assert.equal(min.rows[0]!.min, 1.5);

const max = await db.query("SELECT MAX(v) FROM t_k10");
assert.equal(max.rows[0]!.max, 2.5);

const internalAgg = (db as unknown as {
  computeAggregateRow: (rows: Array<Record<string, unknown>>, aggregate: "SUM" | "AVG" | "MIN" | "MAX", field: string) => Record<string, unknown>;
}).computeAggregateRow(
  [{ v: "1.2" }, { v: "2.8" }, { v: null }],
  "SUM",
  "v",
);
assert.equal(internalAgg.sum, 4);

console.log("ok: K-TVAL-010 aggregate typed internal state/results");
