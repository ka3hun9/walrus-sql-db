import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const operators = ["=", "<>", ">", ">=", "<", "<="] as const;
for (const op of operators) {
  const ast = parseSqlToAst(`SELECT id FROM users WHERE id ${op} (SELECT MIN(user_id) FROM orders)`);
  assert.equal(ast.kind, "select");
  assert.ok(ast.where, `scalar-subquery comparison should parse for operator ${op}`);
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT)");
await db.execute("INSERT INTO users (id) VALUES (1)");
await db.execute("INSERT INTO users (id) VALUES (2)");
await db.execute("INSERT INTO users (id) VALUES (3)");
await db.execute("INSERT INTO orders (id, user_id) VALUES (10, 2)");
await db.execute("INSERT INTO orders (id, user_id) VALUES (11, 3)");

const expectIds = async (op: string, expected: number[]) => {
  const q = await db.query(`SELECT id FROM users WHERE id ${op} (SELECT MIN(user_id) FROM orders) ORDER BY id`);
  assert.deepEqual(
    q.rows.map((r) => r.id),
    expected,
  );
};

await expectIds("=", [2]);
await expectIds("<>", [1, 3]);
await expectIds(">", [3]);
await expectIds(">=", [2, 3]);
await expectIds("<", [1]);
await expectIds("<=", [1, 2]);

console.log("ok: B-PARSE-010 scalar-subquery comparison parsing");
