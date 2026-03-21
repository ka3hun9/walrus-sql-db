import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_opt1_users (id INT PRIMARY KEY, probe INT, region TEXT)");
await db.execute("CREATE TABLE p3_opt1_candidates (id INT PRIMARY KEY, user_probe INT, region TEXT)");

await db.execute("INSERT INTO p3_opt1_users (id, probe, region) VALUES (1, 10, 'APAC')");
await db.execute("INSERT INTO p3_opt1_users (id, probe, region) VALUES (2, 20, 'EU')");
await db.execute("INSERT INTO p3_opt1_users (id, probe, region) VALUES (3, 30, 'APAC')");

await db.execute("INSERT INTO p3_opt1_candidates (id, user_probe, region) VALUES (11, 10, 'APAC')");
await db.execute("INSERT INTO p3_opt1_candidates (id, user_probe, region) VALUES (12, 30, 'APAC')");
await db.execute("INSERT INTO p3_opt1_candidates (id, user_probe, region) VALUES (13, 90, 'EU')");

const uncorrelatedExplain = (
  await db.query(
    "EXPLAIN SELECT id FROM p3_opt1_users WHERE probe IN (SELECT user_probe FROM p3_opt1_candidates WHERE region = 'APAC') ORDER BY id",
  )
).rows[0]!;
assert.match(String(uncorrelatedExplain.logicalRewriteRules ?? ""), /RULE_UNNEST_UNCORRELATED_SUBQUERY/);

const uncorrelatedRows = (
  await db.query(
    "SELECT id FROM p3_opt1_users WHERE probe IN (SELECT user_probe FROM p3_opt1_candidates WHERE region = 'APAC') ORDER BY id",
  )
).rows;
assert.deepEqual(uncorrelatedRows, [{ id: 1 }, { id: 3 }]);

const existsExplain = (
  await db.query(
    "EXPLAIN SELECT id FROM p3_opt1_users WHERE EXISTS (SELECT 1 FROM p3_opt1_candidates WHERE region = 'APAC') ORDER BY id",
  )
).rows[0]!;
assert.match(String(existsExplain.logicalRewriteRules ?? ""), /RULE_UNNEST_UNCORRELATED_SUBQUERY/);

const existsRows = (await db.query("SELECT id FROM p3_opt1_users WHERE EXISTS (SELECT 1 FROM p3_opt1_candidates WHERE region = 'APAC') ORDER BY id")).rows;
assert.deepEqual(existsRows, [{ id: 1 }, { id: 2 }, { id: 3 }]);

const correlatedExplain = (
  await db.query(
    "EXPLAIN SELECT id FROM p3_opt1_users WHERE probe IN (SELECT user_probe FROM p3_opt1_candidates WHERE p3_opt1_candidates.region = outer.region) ORDER BY id",
  )
).rows[0]!;
assert.doesNotMatch(String(correlatedExplain.logicalRewriteRules ?? ""), /RULE_UNNEST_UNCORRELATED_SUBQUERY/);

console.log("ok: P3-OPT-001 uncorrelated subquery unnest rewrite rule + semantics");
