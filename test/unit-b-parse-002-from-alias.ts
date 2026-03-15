import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const astAs = parseSqlToAst("SELECT u.id FROM users AS u");
assert.equal(astAs.kind, "select");
assert.equal(astAs.from.kind, "table");
if (astAs.from.kind === "table") {
  assert.equal(astAs.from.name, "users");
  assert.equal(astAs.from.alias, "u");
}

const astNoAs = parseSqlToAst("SELECT u.id FROM users u");
assert.equal(astNoAs.kind, "select");
assert.equal(astNoAs.from.kind, "table");
if (astNoAs.from.kind === "table") {
  assert.equal(astNoAs.from.name, "users");
  assert.equal(astNoAs.from.alias, "u");
}

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE users (id INT PRIMARY KEY, name TEXT)");
await db.execute("INSERT INTO users (id, name) VALUES (1, 'Alice')");

const qAs = await db.query("SELECT u.id AS id, u.name AS name FROM users AS u WHERE u.id = 1");
assert.equal(qAs.rows.length, 1);
assert.equal(qAs.rows[0]!.id, 1);
assert.equal(qAs.rows[0]!.name, "Alice");

const qNoAs = await db.query("SELECT u.id AS id FROM users u WHERE u.id = 1");
assert.equal(qNoAs.rows.length, 1);
assert.equal(qNoAs.rows[0]!.id, 1);

console.log("ok: B-PARSE-002 FROM table alias with/without AS");
