import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const sql = "SELECT id, name AS n, price * 2 AS double_price, CAST(price AS INT) AS p_int FROM products";
const ast = parseSqlToAst(sql);
assert.equal(ast.kind, "select");
assert.equal(ast.selectItems.length, 4);
assert.equal(ast.selectItems[0]!.expr.kind, "identifier");
assert.equal(ast.selectItems[1]!.alias, "n");
assert.equal(ast.selectItems[2]!.alias, "double_price");
assert.equal(ast.selectItems[3]!.alias, "p_int");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE products (id INT PRIMARY KEY, name TEXT, price FLOAT)");
await db.execute("INSERT INTO products (id, name, price) VALUES (1, 'Apple', 4.5)");

const res = await db.query(
  "SELECT id, name AS n, price * 2 AS double_price, CAST(price AS INT) AS p_int FROM products WHERE id = 1",
);
assert.equal(res.rows.length, 1);
assert.equal(res.rows[0]!.id, 1);
assert.equal(res.rows[0]!.n, "Apple");
assert.equal(res.rows[0]!.double_price, 9);
assert.equal(res.rows[0]!.p_int, 4);

console.log("ok: B-PARSE-001 SELECT fields/aliases/expressions baseline");
