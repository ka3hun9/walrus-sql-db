import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const ast = parseSqlToAst("SELECT COUNT(*), SUM(v), AVG(v), MIN(v), MAX(v) FROM nums");
assert.equal(ast.kind, "select");
assert.equal(ast.selectItems.length, 5);
const fnNames = ast.selectItems.map((it) => (it.expr.kind === "function" ? it.expr.name : "NA"));
assert.deepEqual(fnNames, ["COUNT", "SUM", "AVG", "MIN", "MAX"]);

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE nums_agg (id INT PRIMARY KEY, v INT)");
await db.execute("INSERT INTO nums_agg (id, v) VALUES (1, 10)");
await db.execute("INSERT INTO nums_agg (id, v) VALUES (2, 20)");
await db.execute("INSERT INTO nums_agg (id, v) VALUES (3, 30)");

const qCount = await db.query("SELECT COUNT(*) AS c FROM nums_agg");
assert.equal(qCount.rows[0]!.count, 3);

const qSum = await db.query("SELECT SUM(v) AS s FROM nums_agg");
assert.equal(qSum.rows[0]!.sum, 60);

const qAvg = await db.query("SELECT AVG(v) AS a FROM nums_agg");
assert.equal(qAvg.rows[0]!.avg, 20);

const qMin = await db.query("SELECT MIN(v) AS mn FROM nums_agg");
assert.equal(qMin.rows[0]!.min, 10);

const qMax = await db.query("SELECT MAX(v) AS mx FROM nums_agg");
assert.equal(qMax.rows[0]!.max, 30);

console.log("ok: B-PARSE-013 aggregate syntax coverage");
