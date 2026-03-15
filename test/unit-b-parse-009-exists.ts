import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const ast = parseSqlToAst("SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = outer.id)");
assert.equal(ast.kind, "select");
assert.ok(ast.where, "EXISTS predicate should parse");
if (ast.where?.kind === "raw") {
  assert.match(ast.where.text, /\bEXISTS\s*\(\s*SELECT\b/i);
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users (id INT PRIMARY KEY, name TEXT)");
await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, amount INT)");
await db.execute("INSERT INTO users (id, name) VALUES (1, 'A')");
await db.execute("INSERT INTO users (id, name) VALUES (2, 'B')");
await db.execute("INSERT INTO users (id, name) VALUES (3, 'C')");
await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (10, 1, 50)");
await db.execute("INSERT INTO orders (id, user_id, amount) VALUES (11, 3, 200)");

const correlatedExists = await db.query(
  "SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = outer.id) ORDER BY id",
);
assert.deepEqual(
  correlatedExists.rows.map((r) => r.id),
  [1, 3],
);

const correlatedNotExists = await db.query(
  "SELECT id FROM users WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.user_id = outer.id) ORDER BY id",
);
assert.deepEqual(
  correlatedNotExists.rows.map((r) => r.id),
  [2],
);

const nonCorrelatedExists = await db.query(
  "SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE amount > 150) ORDER BY id",
);
assert.deepEqual(
  nonCorrelatedExists.rows.map((r) => r.id),
  [1, 2, 3],
);

console.log("ok: B-PARSE-009 EXISTS / NOT EXISTS parsing");
