import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astSingle = parseSqlToAst("SELECT region, SUM(amount) FROM sales GROUP BY region");
assert.equal(astSingle.kind, "select");
assert.equal(astSingle.groupBy?.length, 1);

const astMulti = parseSqlToAst("SELECT region, product, COUNT(id) FROM sales GROUP BY region, product");
assert.equal(astMulti.kind, "select");
assert.equal(astMulti.groupBy?.length, 2);

const astExpr = parseSqlToAst("SELECT region, SUM(amount) FROM sales GROUP BY region, amount + tax");
assert.equal(astExpr.kind, "select");
assert.equal(astExpr.groupBy?.length, 2);
assert.equal(astExpr.groupBy?.[1]?.kind, "binary");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE sales (id INT PRIMARY KEY, region TEXT, product TEXT, amount INT, tax INT)");
await db.execute("INSERT INTO sales (id, region, product, amount, tax) VALUES (1, 'APAC', 'A', 10, 1)");
await db.execute("INSERT INTO sales (id, region, product, amount, tax) VALUES (2, 'APAC', 'B', 20, 2)");
await db.execute("INSERT INTO sales (id, region, product, amount, tax) VALUES (3, 'EU', 'A', 30, 3)");

const single = await db.query("SELECT region, SUM(amount) FROM sales GROUP BY region ORDER BY region");
assert.deepEqual(
  single.rows.map((r) => [r.region, r.sum]),
  [
    ["APAC", 30],
    ["EU", 30],
  ],
);

const multi = await db.query(
  "SELECT region, product, COUNT(id) FROM sales GROUP BY region, product ORDER BY region, product",
);
assert.deepEqual(
  multi.rows.map((r) => [r.region, r.product, r.count]),
  [
    ["APAC", "A", 1],
    ["APAC", "B", 1],
    ["EU", "A", 1],
  ],
);

console.log("ok: B-PARSE-011 GROUP BY single/multi/expression parsing");
