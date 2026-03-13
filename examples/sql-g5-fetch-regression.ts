import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

async function setup(c: WalrusSqlClient) {
  await c.execute("CREATE TABLE users (id TEXT, score INT)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u1', 10)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u2', 30)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u3', 20)");
}

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
  const pg = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "postgres",
  });
  await setup(pg);

  const a = await pg.query("SELECT id, score FROM users ORDER BY score DESC FETCH FIRST 2 ROWS ONLY");
  assert.deepEqual(a.rows, [
    { id: "u2", score: 30 },
    { id: "u3", score: 20 },
  ]);

  const b = await pg.query("SELECT id, score FROM users ORDER BY score DESC FETCH NEXT 1 ROW ONLY");
  assert.deepEqual(b.rows, [{ id: "u2", score: 30 }]);

  const mysql = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "mysql",
  });
  await setup(mysql);
  const c = await mysql.query("SELECT id FROM users ORDER BY score DESC FETCH FIRST 2 ROWS ONLY");
  assert.equal(c.rows.length, 2);

  expectCode(
    () => parseSqlToAst("SELECT id FROM users ORDER BY score FETCH FIRST x ROWS ONLY", { dialect: "postgres" }),
    "SQL_SYNTAX_INCOMPLETE_STATEMENT",
  );

  expectCode(
    () => parseSqlToAst("SELECT id FROM users ORDER BY score FETCH FIRST 1 ROWS ONLY", { dialect: "ansi" }),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );

  expectCode(
    () => parseSqlToAst("SELECT TOP 1 id FROM users FETCH FIRST 1 ROWS ONLY", { dialect: "sqlserver" }),
    "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  );

  console.log("sql-g5-fetch-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
