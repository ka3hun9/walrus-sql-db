import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_opt_users (id INT PRIMARY KEY, score INT, email TEXT)");
await db.execute("CREATE TABLE p3_opt_groups (gid INT PRIMARY KEY, user_id INT)");
await db.execute("CREATE INDEX idx_p3_opt_score ON p3_opt_users(score)");

await db.execute("INSERT INTO p3_opt_users (id, score, email) VALUES (1, 50, 'u1')");
await db.execute("INSERT INTO p3_opt_users (id, score, email) VALUES (2, 10, 'u2')");
await db.execute("INSERT INTO p3_opt_users (id, score, email) VALUES (3, 30, 'u3')");
await db.execute("INSERT INTO p3_opt_users (id, score, email) VALUES (4, 20, 'u4')");
await db.execute("INSERT INTO p3_opt_users (id, score, email) VALUES (5, 70, 'u5')");

await db.execute("INSERT INTO p3_opt_groups (gid, user_id) VALUES (1, 1)");
await db.execute("INSERT INTO p3_opt_groups (gid, user_id) VALUES (2, 3)");

const explainEq = (await db.query("EXPLAIN SELECT id FROM p3_opt_users WHERE id = 3")).rows[0]!;
assert.equal(explainEq.logicalPredicateSource, "AST");
assert.match(String(explainEq.logicalRewriteRules ?? ""), /RULE_PREFER_AST_PREDICATE/);
assert.equal(explainEq.physicalAccessPath, "HASH_INDEX_LOOKUP");

const explainOrdered = (await db.query("EXPLAIN SELECT id, score FROM p3_opt_users ORDER BY score ASC")).rows[0]!;
assert.equal(explainOrdered.physicalAccessPath, "BTREE_ORDERED_SCAN");
assert.equal(explainOrdered.physicalOrderSatisfied, true);

const explainJoin = (
  await db.query(
    "EXPLAIN SELECT p3_opt_users.id FROM p3_opt_users INNER JOIN p3_opt_groups ON p3_opt_users.id = p3_opt_groups.user_id",
  )
).rows[0]!;
assert.equal(explainJoin.logicalJoinCount, 1);
assert.match(String(explainJoin.logicalRewriteRules ?? ""), /RULE_CANONICALIZE_JOIN_CHAIN/);
assert.equal(explainJoin.physicalAccessPath, "TABLE_SCAN");

const eqRows = (await db.query("SELECT id FROM p3_opt_users WHERE id = 3")).rows;
assert.deepEqual(eqRows, [{ id: 3 }]);

const orderedRows = (await db.query("SELECT id, score FROM p3_opt_users ORDER BY score ASC")).rows;
assert.deepEqual(orderedRows.map((row) => row.id), [2, 4, 3, 1, 5]);

console.log("ok: P3-OPT-001 logical/physical plan layering (rewrite + cost evaluation)");
