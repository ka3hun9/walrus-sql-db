import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astAggHaving = parseSqlToAst("SELECT region, SUM(amount) FROM sales GROUP BY region HAVING sum > 20");
assert.equal(astAggHaving.kind, "select");
assert.ok(astAggHaving.having, "HAVING with aggregate alias should parse");

const astNonAggHaving = parseSqlToAst("SELECT region, COUNT(id) FROM sales GROUP BY region HAVING region = 'APAC'");
assert.equal(astNonAggHaving.kind, "select");
assert.ok(astNonAggHaving.having, "HAVING with non-aggregate predicate should parse");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE sales_hv (id INT PRIMARY KEY, region TEXT, amount INT)");
await db.execute("INSERT INTO sales_hv (id, region, amount) VALUES (1, 'APAC', 10)");
await db.execute("INSERT INTO sales_hv (id, region, amount) VALUES (2, 'APAC', 20)");
await db.execute("INSERT INTO sales_hv (id, region, amount) VALUES (3, 'EU', 15)");

const aggHaving = await db.query(
  "SELECT region, SUM(amount) FROM sales_hv GROUP BY region HAVING sum > 20 ORDER BY region",
);
assert.deepEqual(
  aggHaving.rows.map((r) => [r.region, r.sum]),
  [["APAC", 30]],
);

const nonAggHaving = await db.query(
  "SELECT region, COUNT(id) FROM sales_hv GROUP BY region HAVING region = 'APAC' ORDER BY region",
);
assert.deepEqual(
  nonAggHaving.rows.map((r) => [r.region, r.count]),
  [["APAC", 2]],
);

console.log("ok: B-PARSE-012 HAVING parsing and grouped constraints");
