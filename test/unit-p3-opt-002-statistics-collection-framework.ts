import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_opt2_users (id INT PRIMARY KEY, score INT, segment TEXT)");

await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (1, 10, 'A')");
await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (2, 10, 'A')");
await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (3, 20, 'B')");
await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (4, NULL, NULL)");
await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (5, 30, 'B')");
await db.execute("INSERT INTO p3_opt2_users (id, score, segment) VALUES (6, 30, 'C')");

const initial = db.getOptimizerStatistics("p3_opt2_users");
assert.equal(initial.length, 1);
const initialTable = initial[0]!;
assert.equal(initialTable.table, "p3_opt2_users");
assert.equal(initialTable.rowCount, 6);
assert.ok(initialTable.analyzedAt > 0);

const initialScore = initialTable.columns.find((column) => column.column === "score");
assert.ok(initialScore);
assert.equal(initialScore!.ndv, 3);
assert.equal(initialScore!.nullCount, 1);
assert.equal(initialScore!.rowCount, 6);
assert.ok(Math.abs(initialScore!.nullRatio - 1 / 6) < 1e-12);
assert.ok(initialScore!.histogram.length >= 1 && initialScore!.histogram.length <= 3);
assert.equal(initialScore!.histogram.reduce((sum, bucket) => sum + bucket.rowCount, 0), 5);
assert.equal(initialScore!.histogram.reduce((sum, bucket) => sum + bucket.ndv, 0), 3);

const explain = (await db.query("EXPLAIN SELECT id FROM p3_opt2_users WHERE score >= 20 ORDER BY score ASC")).rows[0]!;
assert.equal(explain.statsTableRowCount, 6);
assert.equal(explain.statsColumnCount, 3);
assert.equal(explain.statsPredicateColumn, "score");
assert.equal(explain.statsPredicateNdv, 3);
assert.equal(explain.statsPredicateHistogramBuckets, initialScore!.histogram.length);
assert.ok(Number(explain.statsPredicateNullRatio) > 0);

await db.execute("UPDATE p3_opt2_users SET score = 40 WHERE id = 4");
await db.execute("UPDATE p3_opt2_users SET segment = 'D' WHERE id = 4");
await db.execute("DELETE FROM p3_opt2_users WHERE id = 2");

const afterDml = db.getOptimizerStatistics("p3_opt2_users");
assert.equal(afterDml.length, 1);
const afterTable = afterDml[0]!;
assert.equal(afterTable.rowCount, 5);

const afterScore = afterTable.columns.find((column) => column.column === "score");
assert.ok(afterScore);
assert.equal(afterScore!.ndv, 4);
assert.equal(afterScore!.nullCount, 0);
assert.equal(afterScore!.nullRatio, 0);
assert.equal(afterScore!.histogram.reduce((sum, bucket) => sum + bucket.rowCount, 0), 5);
assert.equal(afterScore!.histogram.reduce((sum, bucket) => sum + bucket.ndv, 0), 4);

const allTables = db.getOptimizerStatistics();
assert.ok(allTables.some((table) => table.table === "p3_opt2_users"));

console.log("ok: P3-OPT-002 optimizer statistics collection framework");
