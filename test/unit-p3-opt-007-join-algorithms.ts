import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

async function seedJoinPair(prefix: string, rows: number): Promise<void> {
  await db.execute(`CREATE TABLE ${prefix}_left (id INT PRIMARY KEY, k INT, payload TEXT)`);
  await db.execute(`CREATE TABLE ${prefix}_right (id INT PRIMARY KEY, k INT, tag TEXT)`);

  for (let i = 1; i <= rows; i += 1) {
    await db.execute(`INSERT INTO ${prefix}_left (id, k, payload) VALUES (${i}, ${i}, 'l${i}')`);
    await db.execute(`INSERT INTO ${prefix}_right (id, k, tag) VALUES (${i}, ${i}, 'r${i}')`);
  }
}

await seedJoinPair("p3_opt7_nl", 4);
await seedJoinPair("p3_opt7_hash", 20);
await seedJoinPair("p3_opt7_merge", 80);

const explainNested = (await db.query(
  "EXPLAIN SELECT p3_opt7_nl_left.id FROM p3_opt7_nl_left INNER JOIN p3_opt7_nl_right ON p3_opt7_nl_left.k = p3_opt7_nl_right.k",
)).rows[0]!;
assert.equal(explainNested.physicalJoinCount, 1);
assert.equal(explainNested.physicalJoinAlgorithms, "NESTED_LOOP");
assert.match(String(explainNested.physicalJoinPlan ?? ""), /NESTED_LOOP/);

const nestedRows = (await db.query(
  "SELECT p3_opt7_nl_left.id AS id, p3_opt7_nl_right.tag AS tag FROM p3_opt7_nl_left INNER JOIN p3_opt7_nl_right ON p3_opt7_nl_left.k = p3_opt7_nl_right.k ORDER BY p3_opt7_nl_left.id ASC",
)).rows;
assert.equal(nestedRows.length, 4);
assert.deepEqual(nestedRows[0], { id: 1, tag: "r1" });
assert.deepEqual(nestedRows[3], { id: 4, tag: "r4" });

const explainHash = (await db.query(
  "EXPLAIN SELECT p3_opt7_hash_left.id FROM p3_opt7_hash_left INNER JOIN p3_opt7_hash_right ON p3_opt7_hash_left.k = p3_opt7_hash_right.k",
)).rows[0]!;
assert.equal(explainHash.physicalJoinCount, 1);
assert.equal(explainHash.physicalJoinAlgorithms, "HASH_JOIN");
assert.match(String(explainHash.physicalJoinPlan ?? ""), /HASH_JOIN/);

const hashRows = (await db.query(
  "SELECT p3_opt7_hash_left.id AS id, p3_opt7_hash_right.tag AS tag FROM p3_opt7_hash_left INNER JOIN p3_opt7_hash_right ON p3_opt7_hash_left.k = p3_opt7_hash_right.k ORDER BY p3_opt7_hash_left.id ASC",
)).rows;
assert.equal(hashRows.length, 20);
assert.deepEqual(hashRows[0], { id: 1, tag: "r1" });
assert.deepEqual(hashRows[19], { id: 20, tag: "r20" });

const explainSortMerge = (await db.query(
  "EXPLAIN SELECT p3_opt7_merge_left.id FROM p3_opt7_merge_left INNER JOIN p3_opt7_merge_right ON p3_opt7_merge_left.k = p3_opt7_merge_right.k",
)).rows[0]!;
assert.equal(explainSortMerge.physicalJoinCount, 1);
assert.equal(explainSortMerge.physicalJoinAlgorithms, "SORT_MERGE_JOIN");
assert.match(String(explainSortMerge.physicalJoinPlan ?? ""), /SORT_MERGE_JOIN/);

const mergeRows = (await db.query(
  "SELECT p3_opt7_merge_left.id AS id, p3_opt7_merge_right.tag AS tag FROM p3_opt7_merge_left INNER JOIN p3_opt7_merge_right ON p3_opt7_merge_left.k = p3_opt7_merge_right.k ORDER BY p3_opt7_merge_left.id ASC",
)).rows;
assert.equal(mergeRows.length, 80);
assert.deepEqual(mergeRows[0], { id: 1, tag: "r1" });
assert.deepEqual(mergeRows[79], { id: 80, tag: "r80" });

console.log("ok: P3-OPT-007 join algorithms (Nested Loop / Hash Join / Sort-Merge Join)");
