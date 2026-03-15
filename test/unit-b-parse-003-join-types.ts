import { strict as assert } from "node:assert";
import { parseSqlToAst } from "../src/parser/index.js";
import { WalrusSqlClient } from "../src/client.js";

const inner = parseSqlToAst("SELECT a.id FROM a INNER JOIN b ON a.id = b.id");
assert.equal(inner.kind, "select");
assert.equal(inner.joins?.[0]?.joinType, "INNER");

const leftOuter = parseSqlToAst("SELECT a.id FROM a LEFT OUTER JOIN b ON a.id = b.id");
assert.equal(leftOuter.kind, "select");
assert.equal(leftOuter.joins?.[0]?.joinType, "LEFT");

const right = parseSqlToAst("SELECT a.id FROM a RIGHT JOIN b ON a.id = b.id");
assert.equal(right.kind, "select");
assert.equal(right.joins?.[0]?.joinType, "RIGHT");

const fullOuter = parseSqlToAst("SELECT a.id FROM a FULL OUTER JOIN b ON a.id = b.id");
assert.equal(fullOuter.kind, "select");
assert.equal(fullOuter.joins?.[0]?.joinType, "FULL");

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db.execute("CREATE TABLE a (id INT PRIMARY KEY)");
await db.execute("CREATE TABLE b (id INT PRIMARY KEY)");
await db.execute("INSERT INTO a (id) VALUES (1)");
await db.execute("INSERT INTO b (id) VALUES (1)");

await assert.rejects(
  db.query("SELECT a.id FROM a FULL OUTER JOIN b ON a.id = b.id"),
  /ERR_UNSUPPORTED_SELECT: FULL OUTER JOIN execution is not implemented yet/,
);

console.log("ok: B-PARSE-003 JOIN type parsing (INNER/LEFT/RIGHT/FULL OUTER)");
