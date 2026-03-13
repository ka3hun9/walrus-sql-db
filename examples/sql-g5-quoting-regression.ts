import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

function expectCode(fn: () => unknown, code: string) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, code);
}

async function main() {
  const mysql = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "mysql",
  });

  await mysql.execute("CREATE TABLE users (id TEXT, score INT)");
  await mysql.execute("INSERT INTO users (id, score) VALUES ('u1', 10)");
  await mysql.execute("INSERT INTO users (id, score) VALUES ('u2', 20)");

  const m = await mysql.query("SELECT `id`, `score` FROM `users` ORDER BY `score` DESC LIMIT 1");
  assert.deepEqual(m.rows, [{ id: "u2", score: 20 }]);

  const sqlserver = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "sqlserver",
  });

  await sqlserver.execute("CREATE TABLE users (id TEXT, score INT)");
  await sqlserver.execute("INSERT INTO users (id, score) VALUES ('u1', 10)");
  await sqlserver.execute("INSERT INTO users (id, score) VALUES ('u2', 20)");

  const s = await sqlserver.query("SELECT TOP 1 [id], [score] FROM [users] ORDER BY [score] DESC");
  assert.deepEqual(s.rows, [{ id: "u2", score: 20 }]);

  expectCode(() => parseSqlToAst("SELECT `id` FROM users", { dialect: "ansi" }), "SQL_DIALECT_UNSUPPORTED_SYNTAX");
  expectCode(() => parseSqlToAst("SELECT [id] FROM users", { dialect: "postgres" }), "SQL_DIALECT_UNSUPPORTED_SYNTAX");

  console.log("sql-g5-quoting-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
