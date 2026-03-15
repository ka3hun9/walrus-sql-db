import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const ast = parseSqlToAst("SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)");
assert.equal(ast.kind, "select");
assert.ok(ast.where, "IN-subquery predicate should parse");
if (ast.where?.kind === "raw") {
  assert.match(ast.where.text, /\bIN\s*\(\s*SELECT\b/i);
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT)");
await db.execute("INSERT INTO users (id, name) VALUES (1, 'A')");
await db.execute("INSERT INTO users (id, name) VALUES (2, 'B')");
await db.execute("INSERT INTO users (id, name) VALUES (3, 'C')");
await db.execute("INSERT INTO orders (id, user_id) VALUES (10, 1)");
await db.execute("INSERT INTO orders (id, user_id) VALUES (11, 3)");

const inRows = await db.query(
  "SELECT id FROM users WHERE id IN (SELECT user_id FROM orders) ORDER BY id",
);
assert.deepEqual(
  inRows.rows.map((r) => r.id),
  [1, 3],
);

const notInRows = await db.query(
  "SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders) ORDER BY id",
);
assert.deepEqual(
  notInRows.rows.map((r) => r.id),
  [2],
);

console.log("ok: B-PARSE-008 IN / NOT IN subquery parsing");
