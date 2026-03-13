import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/index.js";
import { SqlEngineError } from "../src/sql-errors.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xdev",
    network: "sui-testnet",
    mode: "simulator",
  });

  await db.execute("CREATE TABLE users (id TEXT, city TEXT)");
  await db.execute("INSERT INTO users (id, city) VALUES ('u1', 'Shanghai')");

  const ok = await db.query("SELECT id FROM users WHERE city = 'Shanghai'");
  assert.equal(ok.rows.length, 1);

  let unknownErr: unknown;
  try {
    await db.query("SELECT id FROM users WHERE missing_col = 1");
  } catch (e) {
    unknownErr = e;
  }

  assert.ok(unknownErr instanceof SqlEngineError, "expected SqlEngineError on unknown identifier");
  assert.equal((unknownErr as SqlEngineError).code, "SQL_SEMANTIC_UNKNOWN_IDENTIFIER");

  console.log("sql-client-g3a-strict-where ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
