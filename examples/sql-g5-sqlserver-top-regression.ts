import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";
import { parseSqlToAst } from "../src/sql-parser.js";
import { SqlEngineError } from "../src/sql-errors.js";

async function main() {
  const sqlserver = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "sqlserver",
  });

  await sqlserver.execute("CREATE TABLE orders (id TEXT, amount INT)");
  await sqlserver.execute("INSERT INTO orders (id, amount) VALUES ('o1', 10)");
  await sqlserver.execute("INSERT INTO orders (id, amount) VALUES ('o2', 30)");
  await sqlserver.execute("INSERT INTO orders (id, amount) VALUES ('o3', 20)");

  const r = await sqlserver.query("SELECT TOP 2 id, amount FROM orders ORDER BY amount DESC");
  assert.deepEqual(r.rows, [
    { id: "o2", amount: 30 },
    { id: "o3", amount: 20 },
  ]);

  let err: unknown;
  try {
    parseSqlToAst("SELECT TOP x id FROM orders", { dialect: "sqlserver" });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, "SQL_SYNTAX_INCOMPLETE_STATEMENT");

  let ansiErr: unknown;
  try {
    parseSqlToAst("SELECT TOP 2 id FROM orders", { dialect: "ansi" });
  } catch (e) {
    ansiErr = e;
  }
  assert.ok(ansiErr instanceof SqlEngineError);
  assert.equal((ansiErr as SqlEngineError).code, "SQL_DIALECT_UNSUPPORTED_SYNTAX");

  console.log("sql-g5-sqlserver-top-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
