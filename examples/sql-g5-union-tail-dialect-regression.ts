import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";
import { SqlEngineError } from "../src/sql-errors.js";

async function seed(c: WalrusSqlClient) {
  await c.execute("CREATE TABLE users (id TEXT, score INT)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u1', 10)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u2', 20)");
  await c.execute("INSERT INTO users (id, score) VALUES ('u3', 30)");
}

async function expectCode(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SqlEngineError);
  assert.equal((err as SqlEngineError).code, code);
}

async function main() {
  const sqlserver = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "sqlserver",
  });
  await seed(sqlserver);

  // valid union tail shape under sqlserver profile
  const ok = await sqlserver.query(
    "SELECT id, score FROM users WHERE score >= 20 UNION ALL SELECT id, score FROM users ORDER BY score DESC OFFSET 0 FETCH NEXT 2 ROWS ONLY",
  );
  assert.equal(ok.rows.length, 2);
  assert.deepEqual(ok.rows[0], { id: "u3", score: 30 });

  // invalid sqlserver tail shape: FETCH without OFFSET
  await expectCode(
    sqlserver.query(
      "SELECT id FROM users UNION ALL SELECT id FROM users ORDER BY id FETCH NEXT 1 ROW ONLY",
    ),
    "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  );

  // ansi profile rejects FETCH in union tail
  const ansi = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
    dialect: "ansi",
  });
  await seed(ansi);
  await expectCode(
    ansi.query(
      "SELECT id FROM users UNION ALL SELECT id FROM users ORDER BY id FETCH FIRST 1 ROW ONLY",
    ),
    "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  );

  console.log("sql-g5-union-tail-dialect-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
